/**
 * Screenshot generator for the docs site.
 *
 * Boots a throwaway copy of `playground/` on a Vite dev server with the plugin
 * (timeline + source overlay + HMR indicator) and `@vitejs/devtools`, drives it
 * with Playwright, and writes every figure the docs reference into
 * `docs/src/assets/shots/` as `<name>.light.png` / `<name>.dark.png` at
 * deviceScaleFactor 2. Existing files are overwritten.
 *
 * Rerun with:
 *
 *     pnpm run docs:shots            # builds the plugin first, then shoots
 *     SHOTS_ONLY=timeline pnpm run docs:shots   # only matching shot names
 *     SHOTS_HEADED=1 pnpm run docs:shots        # watch it happen
 *
 * Adding a figure is one entry in `SHOTS` below: `{name, capture(ctx)}`. Each
 * shot runs twice (light, dark) in its own browser context, so a shot can edit
 * playground sources, flip localStorage, or leave the panel in any state
 * without leaking into the next one — `ctx.edit()` is rolled back for you.
 * A failing shot is logged and the run continues; the process exits non-zero
 * if anything failed.
 *
 * The one exception is `chrome: true`: Chrome's own Performance panel, which
 * needs a real Chrome and its DevTools frontend. It gets a `{origin, shot}`
 * context instead, records once and shoots both themes itself, and it opens a
 * visible Chrome window for a few seconds even without SHOTS_HEADED.
 *
 * The run uses a throwaway HOME, so settings saved in your own Vite DevTools
 * profile stay out of the figures.
 */

import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {launchCleanChrome} from './chrome-profile.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAYGROUND_DIR = path.join(PACKAGE_ROOT, 'playground');
const OUT_DIR = path.join(PACKAGE_ROOT, 'docs/src/assets/shots');
const TMP_ROOT = path.join(PACKAGE_ROOT, '.e2e-tmp');
/** Survives the run (unlike the playground copy) — see the route in `main`. */
const ICON_CACHE = path.join(TMP_ROOT, 'icon-cache');

/** Panel viewport for DevTools shots; app shots clip to an element. */
const PANEL_VIEWPORT = {width: 1200, height: 720};

/**
 * Force every shadow root open. The HMR indicator and the source overlay both
 * use `mode: 'closed'`, which Playwright cannot address at all — no locator,
 * no bounding box, so no clip.
 */
const OPEN_SHADOW_ROOTS = () => {
  // oxlint-disable-next-line typescript/unbound-method -- re-bound via .call below
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return attach.call(this, {...init, mode: 'open'});
  };
};

/** `main` swaps HOME out for the run; real Chrome still needs this one. */
const REAL_HOME = process.env['HOME'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The throwaway playground copy for this run, so teardown can find it even
 *  when `main` throws on the way up (a bad import, a port clash, …). */
let tmpRoot = null;
/** The run's throwaway HOME, beside the playground copy (see `main`). */
const homeDir = (root) => `${root}-home`;

/* ------------------------------------------------------------------ shots */

/** Panel root; every view below hangs off it through open shadow roots. */
const panelRoot = (page) => page.locator('lit-devtools-panel');
const timelineView = (page) => panelRoot(page).locator('css=timeline-view');
const eventList = (page) =>
  timelineView(page).locator('css=timeline-event-list');
const componentsView = (page) => panelRoot(page).locator('css=components-view');
const updatesView = (page) => panelRoot(page).locator('css=updates-view');

/**
 * Click through the playground so the timeline has something to show.
 *
 * Deliberately touches five different components: the Updates tab lists one
 * row per component that updated, and a recording that only pokes the counter
 * leaves that table with a single row and a screenful of nothing under it.
 * The route buttons run three full laps for the same reason — the Router
 * layer is the only thing left after the `navigate` filter in
 * `devtools-custom-layer`.
 */
const exercise = async (app) => {
  const counter = app.locator('hmr-counter').locator('css=#increment');
  for (let i = 0; i < 3; i++) await counter.click();

  const props = app.locator('hmr-properties');
  await props.locator('css=#add-item').click();
  await props.locator('css=#toggle-color-scheme').click();
  await props.locator('css=#add-item').click();

  const staticProps = app
    .locator('hmr-static-props')
    .locator('css=#static-increment');
  await staticProps.click();
  await staticProps.click();

  await app.locator('hmr-lifecycle').locator('css=#toggle').click();
  const child = app.locator('hmr-lifecycle-child').locator('css=#increment');
  if ((await child.count()) > 0) {
    await child.click();
    await child.click();
  }

  const routes = app.locator('hmr-custom-layer').locator('css=nav button');
  for (let lap = 0; lap < 3; lap++) {
    await routes.nth(1).click();
    await routes.nth(2).click();
    await routes.nth(0).click();
  }
};

/**
 * Route clicks woven between counter and list clicks, for the shots that show
 * the Router layer beside Lit's rows.
 */
const exerciseRoutes = async (app) => {
  const counter = app.locator('hmr-counter').locator('css=#increment');
  const add = app.locator('hmr-properties').locator('css=#add-item');
  const routes = app.locator('hmr-custom-layer').locator('css=nav button');
  for (let lap = 0; lap < 6; lap++) {
    await routes.nth((lap + 1) % 3).click();
    await counter.click();
    await sleep(40);
    await add.click();
    await sleep(40);
  }
};

/**
 * Open the app, open the panel on the Timeline tab, record a short session,
 * and stop. Returns both pages with the panel in front.
 *
 * `throttle` slows the app's CPU so sub-ms spans get wide enough to read in
 * Tracks.
 */
const recordSession = async (ctx, {run = exercise, throttle = 1} = {}) => {
  const app = await ctx.openApp();
  const panel = await ctx.openPanel('#tab=timeline');
  const record = timelineView(panel).locator('css=wa-button.record');
  await record.waitFor();
  await record.click();
  await record.and(panel.locator('css=.active')).waitFor();
  await app.bringToFront();
  const cdp = throttle > 1 ? await ctx.context.newCDPSession(app) : null;
  await cdp?.send('Emulation.setCPUThrottlingRate', {rate: throttle});
  await run(app, panel);
  await cdp?.send('Emulation.setCPUThrottlingRate', {rate: 1});
  await sleep(500);
  await panel.bringToFront();
  await record.click();
  await eventList(panel).locator('css=.row').first().waitFor();
  await sleep(300);
  return {app, panel};
};

/**
 * Scroll the Timeline list. `'top'` / `'bottom'`, or a function run in the
 * page that gets the scroller and returns the scrollTop to use. The list
 * pins itself to its newest row whenever events arrive, so this runs after
 * recording stops.
 */
const scrollList = async (page, where) => {
  await eventList(page).evaluate((list, where) => {
    const el = [...list.shadowRoot.querySelectorAll('.scroll')].at(-1);
    if (!el) return;
    el.scrollTop =
      where === 'top' ? 0 : where === 'bottom' ? el.scrollHeight : where;
  }, where);
  await sleep(300);
};

/** Drop focus and park the pointer, so no clicked control carries a focus
 *  ring or a hover state into the shot. */
const blur = async (page) => {
  await page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    el?.blur?.();
  });
  await page.mouse.move(0, 0);
};

/* ------------------------------------------------- Chrome Performance */

/**
 * Chrome's own Performance panel, with the Lit custom tracks
 * (`chromeTracks`) showing one counter click.
 *
 * This one cannot use the Playwright-launched browser: the frontend has to be
 * a real DevTools, and Playwright's headless shell has none to serve. So it
 * runs a clean real Chrome, opens the app in one tab and that Chrome's own
 * DevTools frontend (`/devtools/devtools_app.html?ws=…`, served over the
 * debugging port) in a second, and drives the frontend through its own
 * modules: the panel to record, the parsed trace to find the Lit entries, the
 * bounds manager to zoom to them. Recording timing differs every run, so the
 * window comes from the trace, not from fixed coordinates. One recording is
 * shot twice, the frontend's colour scheme emulated per theme.
 */
const chromePerformanceTracks = async ({origin, shot}) => {
  const chrome = await launchCleanChrome({
    url: 'about:blank',
    size: [1400, 900],
    // The frontend tab talks to the page over a WebSocket on the debugging
    // port, which Chrome refuses from any origin not listed here.
    args: ['--remote-allow-origins=*'],
    env: {...process.env, HOME: REAL_HOME},
  });
  try {
    const app = await chrome.context.newPage();
    // Before the runtime boots, which is when it reads the override.
    await app.addInitScript(() =>
      localStorage.setItem(
        'lit-devtools-overrides',
        JSON.stringify({chromeTracks: true})
      )
    );
    // `localhost`, as a reader's dev server would be: the frontend prints
    // the host in the recording picker and the Main track title.
    await app.goto(`${origin.replace('127.0.0.1', 'localhost')}/`);
    await app.waitForFunction(() => window.__hmr !== undefined);

    const port = (
      await readFile(path.join(chrome.dir, 'DevToolsActivePort'), 'utf8')
    ).split('\n')[0];
    const debug = `127.0.0.1:${port}`;
    const targets = await (await fetch(`http://${debug}/json/list`)).json();
    const target = targets.find(
      (t) => t.type === 'page' && t.url.includes(`:${new URL(origin).port}/`)
    );
    if (!target) throw new Error('app tab not among the debugging targets');

    const fe = await chrome.context.newPage();
    const feCdp = await chrome.context.newCDPSession(fe);
    // The figure is the top 1250x560 of a taller page, at 2x: in a 560px
    // page the details drawer takes the lower half of the flame chart. Set
    // again before each shot, as Playwright's screenshot clears it on the
    // way out.
    const FIGURE = {x: 0, y: 0, width: 1250, height: 560};
    const frame = () =>
      feCdp.send('Emulation.setDeviceMetricsOverride', {
        width: FIGURE.width,
        height: 1000,
        deviceScaleFactor: 2,
        mobile: false,
      });
    await frame();
    // The flame chart opens a keyboard-shortcuts dialog over itself the
    // first time a profile sees a trace; this is the frontend's own switch
    // for keeping it shut.
    await fe.addInitScript(() =>
      localStorage.setItem('hide-shortcuts-dialog-for-test', 'true')
    );
    await fe.goto(
      `http://${debug}/devtools/devtools_app.html?ws=${debug}/devtools/page/${target.id}&panel=timeline`
    );
    // The frontend's modules, imported by the URL it loaded them from, are
    // the live instances; `__timeline` keeps the waits below synchronous.
    await fe.waitForFunction(
      async () => {
        try {
          window.__timeline ??=
            await import('/devtools/panels/timeline/timeline.js');
          // Idle alone is not enough: until the frontend has attached to
          // the page, a recording fails with "Could not load primary page
          // target".
          const {TargetManager} = await import('/devtools/core/sdk/sdk.js');
          const targets = TargetManager.TargetManager.instance();
          return (
            Boolean(targets.rootTarget() && targets.primaryPageTarget()) &&
            window.__timeline.TimelinePanel.TimelinePanel.instance().state ===
              'Idle'
          );
        } catch {
          return false;
        }
      },
      undefined,
      {polling: 250, timeout: 30_000}
    );
    const panelState = () =>
      fe.evaluate(
        () => window.__timeline.TimelinePanel.TimelinePanel.instance().state
      );
    const waitForState = async (want, timeout) => {
      const until = Date.now() + timeout;
      for (let state = await panelState(); state !== want;) {
        if (state === 'RecordingFailed' || Date.now() > until) {
          throw new Error(`Performance panel is ${state}, waited for ${want}`);
        }
        await sleep(250);
        state = await panelState();
      }
    };

    // Unthrottled, an update is a fraction of the 1ms the panel will zoom
    // to, and the Render bar is too short for its label.
    const appCdp = await chrome.context.newCDPSession(app);
    await appCdp.send('Emulation.setCPUThrottlingRate', {rate: 3});
    await fe.evaluate(() =>
      window.__timeline.TimelinePanel.TimelinePanel.instance().toggleRecording()
    );
    await waitForState('Recording', 30_000);
    // The click has to land in a foreground tab, or the page does not
    // render and the trace has no frame to show.
    await app.bringToFront();
    await sleep(800);
    // Several clicks, and the figure shows the one whose Render bar is the
    // largest share of its performUpdate. How long each phase takes varies
    // run to run (a cold first update, a microtask that lands late), and in
    // a bad one the Render bar is too narrow for its label.
    const increment = app.locator('hmr-counter').locator('css=#increment');
    for (let i = 0; i < 5; i++) {
      await increment.click();
      await sleep(300);
    }
    await sleep(800);
    await fe.bringToFront();
    await fe.evaluate(() =>
      window.__timeline.TimelinePanel.TimelinePanel.instance().toggleRecording()
    );
    await waitForState('Idle', 60_000);
    await appCdp.send('Emulation.setCPUThrottlingRate', {rate: 1});

    // A plain click: the toolbar's shortcut-dialog element sits over the
    // button for the pointer, which Playwright's hit test refuses.
    await fe
      .locator('button[aria-label="Hide sidebar"]')
      .evaluate((button) => button.click());
    await sleep(500);
    const found = await fe.evaluate(async () => {
      const {TraceBounds} =
        await import('/devtools/services/trace_bounds/trace_bounds.js');
      const panel = window.__timeline.TimelinePanel.TimelinePanel.instance();
      const data = panel.getParsedTraceForLayoutTests();
      const lit = data.ExtensionTraceData.extensionTrackData.find(
        (g) => g.name === 'Lit'
      );
      const counter = Object.values(lit?.entriesByTrack ?? {})
        .flat()
        .filter((e) => e.name.startsWith('<hmr-counter>'));
      const named = (suffix) =>
        counter.filter((e) => e.name.endsWith(` ${suffix}`));
      const within = (outer, e) =>
        e.ts >= outer.ts && e.ts <= outer.ts + (outer.dur ?? 0);
      let best = null;
      for (const perform of named('performUpdate')) {
        const render = named('render').find((e) => within(perform, e));
        const score = render ? (render.dur ?? 0) / (perform.dur || 1) : 0;
        if (!best || score > best.score) best = {perform, score};
      }
      if (!best) return 0;
      const entries = counter.filter((e) => within(best.perform, e));
      // Centre the counter's update, with room either side for the click
      // task under it. The bounds manager refuses windows under 1ms.
      const min = Math.min(...entries.map((e) => e.ts));
      const max = Math.max(...entries.map((e) => e.ts + (e.dur ?? 0)));
      const range = Math.max((max - min) * 2.5, 1000);
      const mid = (min + max) / 2;
      TraceBounds.BoundsManager.instance().setTimelineVisibleWindow({
        min: mid - range / 2,
        max: mid + range / 2,
        range,
      });
      const main = panel.getFlameChart().getMainFlameChart();
      const groups = main.timelineData().groups;
      for (const name of ['Lit', 'Lifecycle', 'Render']) {
        const i = groups.findIndex((g) => g.name === name);
        if (i >= 0 && !groups[i].expanded) main.toggleGroupExpand(i);
      }
      return entries.length;
    });
    if (found === 0) throw new Error('no <hmr-counter> entries on Lit tracks');

    for (const theme of ['light', 'dark']) {
      // Through the frontend's own CDP session: Playwright's emulateMedia
      // re-applies its viewport emulation and drops the metrics set above.
      await feCdp.send('Emulation.setEmulatedMedia', {
        features: [{name: 'prefers-color-scheme', value: theme}],
      });
      await frame();
      await sleep(800);
      await shot(fe, theme, {clip: FIGURE});
    }
  } finally {
    await chrome.close();
  }
};

const SHOTS = [
  {
    name: 'devtools-chrome-performance-tracks',
    chrome: true,
    capture: chromePerformanceTracks,
  },
  {
    name: 'indicator-idle',
    capture: async (ctx) => {
      const page = await ctx.openApp();
      const box = ctx.indicator(page);
      await box.waitFor();
      await ctx.shot(page, {clip: await ctx.clip(page, box, 20)});
    },
  },
  {
    name: 'indicator-green',
    capture: async (ctx) => {
      const page = await ctx.openApp();
      const box = ctx.indicator(page);
      await box.waitFor();
      await ctx.hmrEdit(page, 'src/hmr-counter.ts', (code) =>
        code.replace('<h2>Counter: HELLO</h2>', '<h2>Counter: live edit</h2>')
      );
      // The pulse keyframes ramp to full opacity at 15% of 2.5s (375ms) and
      // hold until 80% (2s); 500ms is comfortably inside the plateau.
      await sleep(500);
      await ctx.shot(page, {clip: await ctx.clip(page, box, 20)});
    },
  },
  {
    name: 'indicator-cyan',
    capture: async (ctx) => {
      const page = await ctx.openApp();
      const box = ctx.indicator(page);
      await box.waitFor();
      // A `?css-sheet` stylesheet: the batch is a pure style swap, so the dot
      // pulses in the info colour and the counter does not move.
      await ctx.hmrEdit(page, 'src/hmr-vsheet.css', (code) =>
        code.replace('rgb(59, 130, 246)', 'rgb(16, 185, 129)')
      );
      await sleep(500);
      await ctx.shot(page, {clip: await ctx.clip(page, box, 20)});
    },
  },
  {
    name: 'source-overlay-armed',
    capture: async (ctx) => {
      // Smaller viewport: the tooltip is pinned to the bottom edge, so a tall
      // window would put a lot of nothing between it and the hovered card.
      const page = await ctx.openApp({viewport: {width: 900, height: 560}});
      await page.locator('lit-source-overlay').waitFor({state: 'attached'});
      await page.keyboard.press('Control+Shift+S');
      const button = page.locator('hmr-counter').locator('css=#increment');
      const b = await button.boundingBox();
      // `hover()` fails the actionability check under the overlay's modal
      // <dialog>; raw mouse moves are what the overlay listens for anyway.
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(120);
      await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 1);
      await sleep(900);
      await ctx.shot(page);
    },
  },
  {
    name: 'devtools-components-tree',
    capture: async (ctx) => {
      await ctx.openApp();
      const panel = await ctx.openPanel('#tab=components');
      const rows = componentsView(panel).locator('css=.row');
      await rows.first().waitFor();
      await rows.filter({hasText: 'hmr-properties'}).first().click();
      await sleep(600);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-components-pick',
    capture: async (ctx) => {
      const app = await ctx.openApp();
      const panel = await ctx.openPanel('#tab=components');
      const pick = componentsView(panel).locator('css=wa-button.pick');
      await pick.waitFor();
      await pick.click();
      await app.bringToFront();
      const card = app.locator('hmr-counter');
      const b = await card.boundingBox();
      await app.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(150);
      await app.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2);
      await sleep(700);
      await ctx.shot(app);
    },
  },
  {
    name: 'devtools-flash',
    capture: async (ctx) => {
      const page = await ctx.openApp({
        override: {flashUpdates: true, flashUpdatesRamp: true},
      });
      // Mount flashes fire on load; let them fade before making our own.
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-lit-devtools-flash]').length === 0,
        undefined,
        {timeout: 8_000}
      );
      const counter = page.locator('hmr-counter').locator('css=#increment');
      for (let i = 0; i < 4; i++) {
        await counter.click();
        await sleep(60);
      }
      // The clicked button keeps a focus ring otherwise.
      await blur(page);
      await page.evaluate(async () => {
        const els = [...document.querySelectorAll('*')].filter((el) =>
          el.localName.startsWith('hmr-')
        );
        for (const el of els) el.requestUpdate?.();
        await Promise.all(els.map((el) => el.updateComplete ?? null));
      });
      // Boxes hold full opacity for the first 30% of a 450ms fade.
      await sleep(120);
      await ctx.shot(page);
    },
  },
  {
    name: 'devtools-timeline-collapsed',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      // The list follows the newest row; the counter's updates, with their
      // changed `count`, are the first thing the recording did.
      await scrollList(panel, 'top');
      await blur(panel);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-timeline-raw',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      await eventList(panel).locator('css=.filterbar wa-switch').click();
      await sleep(400);
      await blur(panel);
      // The Router's navigate events are the tail of the recording.
      await scrollList(panel, 'bottom');
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-timeline-row-details',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      await scrollList(panel, 'top');
      // The second counter update, so the row above it gives it context.
      const update = eventList(panel)
        .locator('css=.row', {hasText: 'performUpdate'})
        .filter({hasText: 'hmr-counter'})
        .nth(1);
      await update.locator('css=.twisty').click();
      await sleep(200);
      // Its `update` phase, the one that carries the changed keys.
      await eventList(panel)
        .locator('css=.row.nested', {hasText: 'update'})
        .filter({hasNotText: 'willUpdate'})
        .filter({hasNotText: 'updated'})
        .first()
        .click();
      await sleep(400);
      await scrollList(panel, 'top');
      // Shorten the window until the list ends on a row boundary, so no row
      // is cut in half at the detail pane's edge.
      for (let i = 0; i < 4; i++) {
        const cut = await eventList(panel).evaluate((list) => {
          const el = [...list.shadowRoot.querySelectorAll('.scroll')].at(-1);
          const rows = [...(el?.querySelectorAll('.row') ?? [])]
            .map((r) => r.getBoundingClientRect().top)
            .sort((a, b) => a - b);
          if (!el || rows.length < 2) return 0;
          const pitch = rows[1] - rows[0];
          return el.clientHeight % pitch;
        });
        if (cut < 1) break;
        const vp = panel.viewportSize();
        await panel.setViewportSize({
          width: vp.width,
          height: vp.height - Math.ceil(cut),
        });
        await sleep(300);
      }
      await blur(panel);
      await panel.mouse.move(0, 0);
      await sleep(300);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-timeline-tracks',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx, {
        run: async (app) => {
          await exercise(app);
          // A route change: the navigate and the router's own update land at
          // one recording time.
          await app
            .locator('hmr-custom-layer')
            .locator('css=nav button')
            .nth(1)
            .click();
          // Something after it, or the pan clamps that pair to the end of
          // the recording and the window cannot centre on it.
          await sleep(200);
          await app.locator('hmr-properties').locator('css=#add-item').click();
        },
        // A slower CPU, so the update is wide enough for its label.
        throttle: 4,
      });
      await timelineView(panel)
        .locator('css=.modes [role="radio"][data-mode="tracks"]')
        .click();
      const tracks = timelineView(panel).locator('css=timeline-tracks');
      await tracks.locator('css=.mark').first().waitFor();
      // Zoom to the tightest window holding a navigate and the router
      // update it caused, through the element's own view setter: wheel zoom anchors
      // on the pointer and cannot aim at a span it has not drawn yet.
      const key = await tracks.evaluate((el) => {
        const navs = el.spans.filter((s) => s.layerId === 'app-router');
        const updates = el.spans.filter(
          (s) =>
            s.name === 'performUpdate' &&
            s.end !== undefined &&
            s.meta?.tagName === 'hmr-custom-layer'
        );
        let best = null;
        for (const u of updates) {
          for (const n of navs) {
            const a = Math.min(u.start, n.start);
            const b = Math.max(u.end, n.start);
            if (!best || b - a < best.b - best.a) best = {a, b, u};
          }
        }
        if (!best) return null;
        const span = best.b - best.a;
        const width = span * 1.25 + 0.3;
        const start = best.a - (width - span) / 2;
        // The tracks element's own view state (private members): no input
        // gesture lands this precisely. A rename makes the shot fail loudly.
        const {origin, extent} = el._bounds;
        el._setView(extent / width, start - origin);
        return best.u.key;
      });
      if (key === null) throw new Error('no router update beside a navigate');
      await sleep(300);
      await tracks.evaluate((el, key) => el._select(key), key);
      // Park the pointer off the plot, or its "wheel to zoom" hint tooltip
      // sits over the axis.
      await panel.mouse.move(0, 0);
      await blur(panel);
      // Four lanes and the detail pane; the default height leaves a band of
      // empty plot between them.
      await panel.setViewportSize({width: PANEL_VIEWPORT.width, height: 560});
      await sleep(600);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-custom-layer',
    capture: async (ctx) => {
      // Unfiltered, so the Router's navigate rows sit among Lit's own rows.
      const {panel} = await recordSession(ctx, {run: exerciseRoutes});
      await blur(panel);
      await scrollList(panel, 'bottom');
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-updates-table',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      await ctx.tab(panel, 'updates');
      await updatesView(panel).locator('css=.row').first().waitFor();
      await sleep(300);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-updates-detail',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      await ctx.tab(panel, 'updates');
      const rows = updatesView(panel).locator('css=.pane.components .row');
      await rows.first().waitFor();
      const counter = rows.filter({hasText: 'hmr-counter'});
      await (
        (await counter.count()) > 0 ? counter.first() : rows.first()
      ).click();
      await sleep(400);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-settings-tab',
    capture: async (ctx) => {
      await ctx.openApp();
      const panel = await ctx.openPanel('#tab=settings');
      const settings = panelRoot(panel).locator('css=devtools-settings');
      await settings.waitFor();
      await sleep(700);
      // One override, so the note gets its Reset to env button. Switched
      // on, not toggled: overrides live in the dev server's session, so the
      // light run's is still there when the dark one starts.
      const flash = settings
        .locator('css=tr', {hasText: 'flash updates'})
        .locator('css=wa-switch');
      if (!(await flash.evaluate((el) => el.checked))) await flash.click();
      await sleep(400);
      await blur(panel);
      // Tall enough for the Timeline section at the bottom.
      const height = await settings.evaluate((el) =>
        Math.ceil(el.getBoundingClientRect().top + el.scrollHeight)
      );
      await panel.setViewportSize({
        width: PANEL_VIEWPORT.width,
        height: Math.max(PANEL_VIEWPORT.height, height + 16),
      });
      await sleep(500);
      await ctx.shot(panel);
      // Drop it again, so the shots after this one start from the defaults.
      await settings.locator('css=wa-button.reset').click();
      await sleep(300);
    },
  },
  {
    name: 'devtools-export-snapshot',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      const toolbar = timelineView(panel).locator('css=.toolbar');
      await toolbar
        .locator('css=wa-button', {hasText: 'Export snapshot'})
        .click();
      const note = timelineView(panel).locator('css=.export-note');
      await note.waitFor();
      await note.filter({hasText: 'Wrote'}).waitFor({timeout: 60_000});
      const text = await note.innerText();
      const dir = text.replace(/^.*\bto\s+/s, '').trim();
      // Written relative to the server process cwd, which we chdir into the
      // temp copy for exactly this reason — nothing lands in the repo.
      const abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
      const frozen = await ctx.serveStatic(abs);
      const page = await ctx.context.newPage();
      // The snapshot's own origin; start it on the list, like the others.
      await page.addInitScript(() =>
        localStorage.setItem('lit-devtools-timeline-mode', 'list')
      );
      await page.goto(`${frozen}/index.html#tab=timeline`);
      await panelRoot(page).waitFor();
      await eventList(page).locator('css=.row').first().waitFor();
      await sleep(500);
      await ctx.shot(page);
    },
  },
  {
    name: 'devtools-panel-docked',
    capture: async (ctx) => {
      await ctx.openApp();
      const {page, frame} = await ctx.openHub('Lit');
      const rows = frame
        .locator('lit-devtools-panel')
        .locator('css=components-view')
        .locator('css=.row');
      await rows.first().waitFor();
      await rows.filter({hasText: 'hmr-properties'}).first().click();
      await sleep(800);
      await ctx.shot(page);
    },
  },
];

/* ---------------------------------------------------------------- harness */

const staticHandler = (dir) => (req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.join(dir, rel === '/' ? '/index.html' : rel);
  if (!file.startsWith(dir)) {
    res.writeHead(403).end();
    return;
  }
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.map': 'application/json',
    '.woff2': 'font/woff2',
  };
  res.setHeader(
    'content-type',
    types[path.extname(file)] ?? 'application/octet-stream'
  );
  createReadStream(file)
    .on('error', () => res.writeHead(404).end())
    .pipe(res);
};

const main = async () => {
  const only = process.env['SHOTS_ONLY'] ?? '';
  const selected = SHOTS.filter((s) => s.name.includes(only));
  if (selected.length === 0) {
    throw new Error(`SHOTS_ONLY=${only} matched none of ${SHOTS.length} shots`);
  }

  const root = (tmpRoot = path.join(
    TMP_ROOT,
    `shots-${randomUUID().slice(0, 8)}`
  ));
  await mkdir(OUT_DIR, {recursive: true});
  // Vite DevTools keeps a per-user settings store in ~/.vite/devtools. The
  // panel adopts the override saved there and the server replays it to the
  // page, so whatever the person running this toggled for themselves (flash
  // updates, Chrome tracks, …) would end up in the figures. An empty HOME
  // gives every run the documented defaults.
  await mkdir(homeDir(root), {recursive: true});
  process.env['HOME'] = homeDir(root);
  process.env['USERPROFILE'] = homeDir(root);
  // Mirrors src/test/e2e/utils.ts: the copy lives inside the package so bare
  // imports still resolve, and the playground's own manifests/config would
  // skew dep resolution against the inline config below.
  const EXCLUDE = new Set([
    'package.json',
    'package-lock.json',
    '.npmrc',
    'node_modules',
  ]);
  await cp(PLAYGROUND_DIR, root, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return (
        !base.startsWith('vite.config') &&
        !base.startsWith('.env') &&
        !EXCLUDE.has(base)
      );
    },
  });

  const {litPlugin} = await import(
    pathToFileURL(path.join(PACKAGE_ROOT, 'index.js')).href
  );
  // `@vitejs/devtools` is only a playground dependency; resolve it from there.
  const playgroundRequire = createRequire(
    new URL('../playground/package.json', import.meta.url)
  );
  const {DevTools} = await import(
    pathToFileURL(playgroundRequire.resolve('@vitejs/devtools')).href
  );

  // The snapshot export writes its directory relative to the server process
  // cwd. Every path this script uses is absolute, so moving cwd into the
  // throwaway copy keeps the export out of the repo.
  process.chdir(root);

  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    server: {host: '127.0.0.1', port: 0},
    css: {
      transformer: 'lightningcss',
      lightningcss: {targets: {chrome: 100 << 16, safari: 15 << 16}},
    },
    plugins: [
      litPlugin({
        timeline: true,
        sourceOverlay: true,
        hmr: {indicator: {count: true}},
      }),
      ...(await DevTools({clientAuth: false})),
    ],
  });
  await server.listen();
  const {port} = server.httpServer.address();
  const origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env['SHOTS_HEADED'] === undefined,
  });

  const statics = [];
  const written = [];
  const failed = [];

  for (const shot of selected) {
    if (shot.chrome) {
      // Its own real Chrome, one recording, both themes: see the shot.
      try {
        await shot.capture({
          origin,
          async shot(page, theme, options = {}) {
            const file = path.join(OUT_DIR, `${shot.name}.${theme}.png`);
            await page.screenshot({path: file, ...options});
            written.push(file);
          },
        });
        console.log(`  ok   ${shot.name}`);
      } catch (error) {
        failed.push({label: shot.name, error});
        console.error(`  FAIL ${shot.name}: ${error?.message ?? error}`);
      }
      continue;
    }
    for (const theme of ['light', 'dark']) {
      const label = `${shot.name}.${theme}`;
      const context = await browser.newContext({
        viewport: PANEL_VIEWPORT,
        deviceScaleFactor: 2,
        colorScheme: theme,
      });
      await context.addInitScript(OPEN_SHADOW_ROOTS);
      // The DevTools hub's own chrome pulls its rail icons from
      // api.iconify.design, which answers without CORS headers — the browser
      // drops them and the rail photographs as broken-icon glyphs. Refetch
      // server-side and re-fulfil with a permissive header.
      //
      // Cached on disk because the CDN rate-limits: a few reruns of this
      // script in a row start earning 429s, and a 429 renders exactly like the
      // CORS failure it replaced. Only the hub chrome in
      // `devtools-panel-docked` is affected, so a cold, offline, or
      // rate-limited run still produces every other shot.
      await context.route('https://api.iconify.design/**', async (route) => {
        const url = route.request().url();
        const key = path.join(
          ICON_CACHE,
          `${createHash('sha1').update(url).digest('hex')}.svg`
        );
        const headers = {
          'content-type': 'image/svg+xml',
          'access-control-allow-origin': '*',
        };
        const cached = await readFile(key, 'utf8').catch(() => null);
        if (cached !== null) {
          await route.fulfill({body: cached, headers});
          return;
        }
        try {
          const response = await route.fetch();
          const body = await response.text();
          if (response.status() === 200) {
            await mkdir(ICON_CACHE, {recursive: true});
            await writeFile(key, body);
          }
          await route.fulfill({status: response.status(), body, headers});
        } catch {
          await route.abort();
        }
      });
      const edits = [];
      const ctx = {
        theme,
        context,
        origin,
        root,

        /** The indicator's inner box — the thing worth clipping to. */
        indicator: (page) =>
          page.locator('lit-devtools-hmr-indicator').locator('css=#container'),

        async openApp(options = {}) {
          const page = await context.newPage();
          if (options.viewport) await page.setViewportSize(options.viewport);
          if (options.override) {
            await page.addInitScript(
              ([key, value]) => localStorage.setItem(key, value),
              ['lit-devtools-overrides', JSON.stringify(options.override)]
            );
          }
          await page.goto(`${origin}/`);
          await page.waitForFunction(() => window.__hmr !== undefined);
          return page;
        },

        async openPanel(hash = '') {
          const page = await context.newPage();
          // The shots start from the list; the tracks shot switches over.
          await page.addInitScript(() =>
            localStorage.setItem('lit-devtools-timeline-mode', 'list')
          );
          await page.goto(`${origin}/__lit/${hash}`);
          await panelRoot(page).waitFor();
          await sleep(400);
          return page;
        },

        /**
         * The panel where users actually meet it: docked inside the Vite
         * DevTools hub at `/__devtools/`. The hub mounts each dock's SPA in an
         * iframe inside its own shadow root, so the panel is a frame away —
         * hence the returned `frame` handle; a plain page locator stops at the
         * frame boundary. Rail buttons carry `aria-label`, not `title`.
         */
        async openHub(dockLabel) {
          const page = await context.newPage();
          await page.goto(`${origin}/__devtools/`);
          // The rail icons are CDN round trips (see the route above) and the
          // hub renders a broken-icon glyph until they land, so wait the
          // network out before anything gets photographed.
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.locator(`button[aria-label="${dockLabel}"]`).click();
          const frame = page.frameLocator('iframe[data-iframe-pane="lit"]');
          await frame.locator('lit-devtools-panel').waitFor();
          await page.waitForLoadState('networkidle').catch(() => {});
          await sleep(600);
          return {page, frame};
        },

        /** Switch tabs through the hash, which the panel treats as a deep link. */
        async tab(page, name) {
          await page.evaluate((t) => {
            location.hash = `tab=${t}`;
          }, name);
          await sleep(400);
        },

        /** Edit a source file in the copy and wait for the HMR round trip. */
        async hmrEdit(page, rel, transform) {
          const before = await page.evaluate(() => window.__hmr.updates);
          const file = path.join(root, rel);
          const original = await readFile(file, 'utf8');
          const next = transform(original);
          if (next === original) {
            throw new Error(`edit of ${rel} changed nothing`);
          }
          edits.push({file, original});
          await writeFile(file, next);
          await page.waitForFunction((n) => window.__hmr.updates > n, before, {
            timeout: 15_000,
          });
        },

        /** A viewport-clamped clip box around a locator. */
        async clip(page, locator, pad = 16) {
          const b = await locator.boundingBox();
          if (b === null) throw new Error('locator has no bounding box');
          const vp = page.viewportSize();
          const x = Math.max(0, Math.round(b.x - pad));
          const y = Math.max(0, Math.round(b.y - pad));
          return {
            x,
            y,
            width: Math.min(vp.width - x, Math.round(b.width + pad * 2)),
            height: Math.min(vp.height - y, Math.round(b.height + pad * 2)),
          };
        },

        /** Serve a directory from disk on its own origin (snapshot replay). */
        async serveStatic(dir) {
          const http = createHttpServer(staticHandler(dir));
          await new Promise((r) => http.listen(0, '127.0.0.1', r));
          statics.push(http);
          return `http://127.0.0.1:${http.address().port}`;
        },

        async shot(page, options = {}) {
          await page.bringToFront();
          const file = path.join(OUT_DIR, `${options.name ?? label}.png`);
          await page.screenshot({
            path: file,
            ...(options.clip ? {clip: options.clip} : {}),
          });
          written.push(file);
        },
      };

      try {
        await shot.capture(ctx);
        console.log(`  ok   ${label}`);
      } catch (error) {
        failed.push({label, error});
        console.error(`  FAIL ${label}: ${error?.message ?? error}`);
      } finally {
        await context.close().catch(() => {});
        // Roll back after the context is gone so the revert's own HMR pulse
        // cannot land in a screenshot.
        for (const {file, original} of edits.reverse()) {
          await writeFile(file, original).catch(() => {});
        }
      }
    }
  }

  await browser.close().catch(() => {});
  for (const http of statics) await new Promise((r) => http.close(r));
  await server.close().catch(() => {});

  console.log(`\n${written.length} png(s) in ${OUT_DIR}`);
  if (failed.length > 0) {
    console.error(`${failed.length} shot(s) failed:`);
    for (const {label, error} of failed) {
      console.error(`  ${label}: ${error?.stack ?? error}`);
    }
    process.exitCode = 1;
  }
};

try {
  await main();
} finally {
  // Unconditional: a throw anywhere above still leaves a full playground copy
  // (and, past the first export, a `lit-devtools-snapshot/`) under .e2e-tmp.
  process.chdir(PACKAGE_ROOT);
  if (tmpRoot !== null) {
    await rm(tmpRoot, {recursive: true, force: true});
    await rm(homeDir(tmpRoot), {recursive: true, force: true});
  }
}
