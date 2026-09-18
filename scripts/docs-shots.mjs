/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The throwaway playground copy for this run, so teardown can find it even
 *  when `main` throws on the way up (a bad import, a port clash, …). */
let tmpRoot = null;

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
 * Open the app, open the panel on the Timeline tab, record a short session,
 * and stop. Returns both pages with the panel in front.
 */
const recordSession = async (ctx) => {
  const app = await ctx.openApp();
  const panel = await ctx.openPanel('#tab=timeline');
  const record = timelineView(panel).locator('css=button.record');
  await record.waitFor();
  await record.click();
  await record.and(panel.locator('css=.active')).waitFor();
  await app.bringToFront();
  await exercise(app);
  await sleep(500);
  await panel.bringToFront();
  await record.click();
  await eventList(panel).locator('css=.row').first().waitFor();
  await sleep(300);
  return {app, panel};
};

const SHOTS = [
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
      const pick = componentsView(panel).locator('css=button.pick');
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
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-timeline-raw',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      await eventList(panel).locator('css=.filterbar button').click();
      await sleep(400);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-timeline-row-details',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      const rows = eventList(panel).locator('css=.row');
      const update = rows.filter({hasText: 'update'});
      await (
        (await update.count()) > 0 ? update.first() : rows.first()
      ).click();
      await sleep(400);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-custom-layer',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      // The Router layer's events are the only ones titled `navigate …`, and
      // custom layers have no toggle chip — the regex box is the filter.
      await eventList(panel).locator('css=input.regex').fill('navigate');
      await sleep(400);
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
      await panelRoot(panel).locator('css=devtools-settings').waitFor();
      await sleep(700);
      await ctx.shot(panel);
    },
  },
  {
    name: 'devtools-export-snapshot',
    capture: async (ctx) => {
      const {panel} = await recordSession(ctx);
      const toolbar = timelineView(panel).locator('css=.toolbar');
      await toolbar.locator('css=button', {hasText: 'Export snapshot'}).click();
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
  if (tmpRoot !== null) await rm(tmpRoot, {recursive: true, force: true});
}
