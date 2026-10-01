import {randomUUID} from 'node:crypto';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer, type ViteDevServer} from 'vite';
import {chromium, type Browser, type Page} from 'playwright-core';
import {litPlugin, type LitPluginOptions} from '../../index.js';
import {litCssQueries, litTimelineVirtual} from '../../lib/plugin.js';
import {canarySettings} from '../canary.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PLAYGROUND_DIR = path.join(PACKAGE_ROOT, 'playground');

export interface Fixture {
  server: ViteDevServer;
  browser: Browser;
  page: Page;
  root: string;
  /**
   * The `$HOME` this fixture's dev server runs under. Devframe keeps the
   * panel's per-user settings in `<home>/.vite/devtools`, so this is where
   * they land instead of the developer's real one.
   */
  home: string;
  /** Origin of the dev server, no trailing slash. */
  origin: string;
  /**
   * Opens the built DevTools panel (`dist/client`, served by the devframe at
   * `/__lit/`) in a new tab of the same browser and waits for it to mount.
   * Needs `startFixture({panel: true})`. Console output and uncaught page
   * errors collect in `errors` from before the first navigation.
   */
  openPanel(): Promise<PanelHandle>;
  /**
   * Edits a fixture file relative to the served root and lets the dev
   * server pick it up. Throws on no-op transforms so a green test can't be
   * silently vacuous.
   */
  edit(rel: string, transform: (code: string) => string): Promise<void>;
  /**
   * Names the layer a poll on the last `edit` stalled at, for the failure
   * message of a timed-out wait: the watcher never saw the write, the page
   * never applied an HMR update, or an update landed but the DOM didn't
   * change. Diagnostic only; call it from a catch.
   */
  stalledLayer(): Promise<string>;
  close(): Promise<void>;
}

export interface PanelHandle {
  page: Page;
  /** `console.error` messages and uncaught exceptions, in arrival order. */
  errors: string[];
}

export interface StartFixtureOptions {
  /**
   * Turn on the Vite DevTools hub so the plugin mounts its devframe and
   * serves the built panel at `/__lit/`. Off by default: most tests never
   * look at the panel and shouldn't pay for the hub. Requires `pnpm build`.
   */
  panel?: boolean;
  /**
   * Pre-populates the panel's per-user settings (the devframe global store
   * for the `lit` namespace: `override`, `overrideBaselines`, `appearance`)
   * before the server starts, which reads them once at boot.
   */
  seedSettings?: Record<string, unknown>;
  /** `false` disables the plugin entirely (baseline runs). */
  plugin?: false | LitPluginOptions;
}

export const startFixture = async (
  options: StartFixtureOptions = {}
): Promise<Fixture> => {
  // Copy inside the package — bare imports resolve by walking up to the
  // repo-root node_modules; the OS tmpdir would break that.
  const root = path.join(
    PACKAGE_ROOT,
    '.e2e-tmp',
    `pg-${randomUUID().slice(0, 8)}`
  );
  // The e2e server uses inline config; the manifest files exist only for
  // standalone (StackBlitz/bolt.new) runs and would skew dep resolution.
  const FIXTURE_EXCLUDE = new Set([
    'package.json',
    'package-lock.json',
    '.npmrc',
    'node_modules',
  ]);
  // Devframe resolves its per-user global store from `os.homedir()` with no
  // option to redirect it under Vite DevTools, and Node's `homedir()` reads
  // `$HOME` on every call. Point it at a throwaway dir for the fixture's
  // lifetime so panel settings never touch the developer's own. Chromium is
  // launched with the real value (below) so the browser isn't affected.
  const realHome = process.env['HOME'];
  const home = `${root}-home`;
  await mkdir(home, {recursive: true});
  process.env['HOME'] = home;
  if (options.seedSettings !== undefined) {
    const dir = path.join(home, '.vite', 'devtools', 'settings');
    await mkdir(dir, {recursive: true});
    await writeFile(
      path.join(dir, 'lit.json'),
      JSON.stringify(options.seedSettings)
    );
  }
  await cp(PLAYGROUND_DIR, root, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      // Drop the vite config (inline config below) and any `.env*` files so a
      // developer's local playground env can't perturb deterministic e2e runs.
      return (
        !base.startsWith('vite.config') &&
        !base.startsWith('.env') &&
        !FIXTURE_EXCLUDE.has(base)
      );
    },
  });
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    // Empty unless LIT_CANARY=1 (see ../canary.ts).
    ...canarySettings(),
    server: {host: '127.0.0.1', port: 0},
    // `clientAuth: false` skips the terminal approval prompt nobody can
    // answer in a test run (same as playground/vite.config.ts).
    ...(options.panel === true
      ? {devtools: {enabled: true, clientAuth: false}}
      : {}),
    // Baseline runs keep the CSS import-query plugin and the timeline
    // virtual-module stub (the playground source can't boot without either:
    // hmr-custom-layer.ts imports `virtual:lit-plugin/timeline`) but drop the
    // HMR plugin — neither provides an HMR boundary, so the baseline's
    // full-reload claim is unaffected.
    plugins:
      options.plugin === false
        ? [litCssQueries(), litTimelineVirtual()]
        : [litPlugin(options.plugin ?? {})],
  });
  // Every watcher `change` since boot, so a timed-out wait after `edit` can
  // say whether the write ever reached Vite (see `stalledLayer`).
  const watcherChanges: {file: string; at: number}[] = [];
  server.watcher.on('change', (file) =>
    watcherChanges.push({file, at: Date.now()})
  );
  await server.listen();
  const address = server.httpServer!.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('dev server has no address');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}/`;

  const executablePath = process.env['HMR_E2E_EXECUTABLE'];
  const browser = await chromium.launch({
    env: {...process.env, ...(realHome === undefined ? {} : {HOME: realHome})},
    ...(executablePath !== undefined && executablePath !== ''
      ? {executablePath}
      : {channel: 'chrome'}),
    headless: process.env['HMR_E2E_HEADED'] === undefined,
  });
  const page = await browser.newPage();
  const ready = () =>
    page.waitForFunction(
      () => (window as {__hmr?: unknown}).__hmr !== undefined
    );
  await page.goto(url);
  await ready();
  // Defensive: if the dep optimizer discovered anything on first load, its
  // full-reload has settled by now; a clean reload makes test state
  // (clicks, focus) immune to it.
  await page.reload();
  await ready();

  let lastEdit: {file: string; at: number; updates: number | null} | undefined;
  const pageUpdates = () =>
    page
      .evaluate(
        () => (window as unknown as {__hmr: {updates: number}}).__hmr.updates
      )
      .catch(() => null);

  return {
    server,
    browser,
    page,
    root,
    home,
    origin,
    openPanel: async () => {
      if (options.panel !== true) {
        throw new Error('openPanel needs startFixture({panel: true})');
      }
      const panel = await browser.newPage();
      const errors: string[] = [];
      panel.on('pageerror', (error) => errors.push(error.message));
      panel.on('console', (msg) => {
        if (msg.type() !== 'error') {
          return;
        }
        errors.push(`${msg.text()} @ ${msg.location().url}`);
      });
      await panel.goto(`${origin}/__lit/`);
      await panel.waitForSelector('lit-devtools-panel');
      return {page: panel, errors};
    },
    edit: async (rel, transform) => {
      const file = path.join(root, rel);
      const code = await readFile(file, 'utf8');
      const next = transform(code);
      if (next === code) {
        throw new Error(`edit produced no change: ${rel}`);
      }
      lastEdit = {file, at: Date.now(), updates: await pageUpdates()};
      await writeFile(file, next);
    },
    stalledLayer: async () => {
      if (lastEdit === undefined) {
        return 'stalled layer unknown: no edit was made';
      }
      const {file, at, updates} = lastEdit;
      const seen = watcherChanges.filter((c) => c.file === file && c.at >= at);
      const now = await pageUpdates();
      const since = Date.now() - at;
      if (seen.length === 0) {
        return `stalled at the watcher: no change event for ${file} in ${since}ms after the write (${watcherChanges.length} events since boot)`;
      }
      const lag = seen[0]!.at - at;
      if (updates === null || now === null || now <= updates) {
        return `stalled at HMR: watcher saw ${file} after ${lag}ms (${seen.length} events) but the page applied no update (vite:afterUpdate count ${updates} -> ${now})`;
      }
      return `stalled at the DOM: watcher saw ${file} after ${lag}ms and the page applied ${now - updates} update(s), but the expected change never showed`;
    },
    close: async () => {
      await browser.close();
      await server.close();
      if (realHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = realHome;
      await rm(root, {recursive: true, force: true});
      await rm(home, {recursive: true, force: true});
    },
  };
};

/**
 * The headers a browser on the dev server's own page puts on a request to the
 * DevTools endpoints.
 *
 * `isTrustedRequest` (src/lib/http.ts) rejects anything that carries neither
 * `Origin` nor `Sec-Fetch-Site`, which is every request Node's `http` client
 * makes unless it is told otherwise. Tests that drive these endpoints outside
 * a page have to spell out what the page would have sent: `Sec-Fetch-Site` on
 * everything, plus `Origin` on the non-GET requests that a browser would
 * attach it to.
 */
export const sameOriginHeaders = (
  port: number,
  method: 'GET' | 'POST' = 'POST'
): Record<string, string> => ({
  'sec-fetch-site': 'same-origin',
  ...(method === 'GET' ? {} : {origin: `http://127.0.0.1:${port}`}),
});

// Selector paths are `>>`-separated, hopping into a shadow root at each
// step (e.g. `'hmr-parent >> hmr-child >> #badge'`). Each `page.evaluate`
// embeds the same tiny resolver loop — evaluate callbacks are serialized,
// so they can't share a closure.

/** Pins a node's identity in `window.__hmr.keep` for later comparison. */
export const keepShadow = (
  page: Page,
  key: string,
  path: string
): Promise<void> =>
  page.evaluate(
    ([key, path]) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      if (node === null) {
        throw new Error(`keepShadow: no node for ${path}`);
      }
      (
        window as unknown as {__hmr: {keep: Map<string, unknown>}}
      ).__hmr.keep.set(key, node);
    },
    [key, path] as const
  );

/** The pinned node is still the one in the live DOM. */
export const sameAsKept = (
  page: Page,
  key: string,
  path: string
): Promise<boolean> =>
  page.evaluate(
    ([key, path]) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      const kept = (
        window as unknown as {__hmr: {keep: Map<string, unknown>}}
      ).__hmr.keep.get(key);
      return (
        kept !== undefined && node !== null && kept === node && node.isConnected
      );
    },
    [key, path] as const
  );

/** Trimmed text content of the node at a selector path (null if absent). */
export const shadowText = (page: Page, path: string): Promise<string | null> =>
  page
    .evaluate((path) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      return node?.textContent?.trim() ?? null;
    }, path)
    .catch(() => null);

export const dataRenders = (page: Page, path: string): Promise<string | null> =>
  page
    .evaluate((path) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      return node?.getAttribute('data-renders') ?? null;
    }, path)
    .catch(() => null);

export const hmrUpdates = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as {__hmr: {updates: number}}).__hmr.updates
  );

/**
 * Appends `<tag>` to the page and waits for its first render.
 *
 * The clock demos are commented out of `playground/index.html` — they
 * re-render every second and flood the DevTools Timeline — but `main.ts`
 * still imports their modules, so the elements stay registered and the e2e
 * runs can mount them on demand.
 */
export const mountElement = async (page: Page, tag: string): Promise<void> => {
  await page.evaluate((tag) => {
    if (document.querySelector(tag) !== null) {
      return;
    }
    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(document.createElement(tag));
    (document.querySelector('main') ?? document.body).appendChild(card);
  }, tag);
  await page.waitForFunction(
    (tag) => document.querySelector(tag)?.shadowRoot != null,
    tag
  );
};

/**
 * Filesystem helpers, re-exported for e2e tests that inspect what the plugin
 * wrote to disk.
 *
 * Not indirection for its own sake: `src/test/**` sits outside the root
 * `tsconfig.json`, so the pre-commit hook's per-file type check compiles a
 * staged test without `@types/node` and rejects a plain `node:fs/promises`
 * import. This module already needs one, so tests borrow it from here.
 */
export const fsp = {mkdir, readdir, readFile, rm, symlink, writeFile};

/** `path.join`, borrowed for the same reason as `fsp`. */
export const joinPath = path.join;

/**
 * A unique throwaway root under `.e2e-tmp/`. Inside the package, not the OS
 * tmpdir: fixtures resolve bare imports by walking up to the repo-root
 * `node_modules`.
 */
export const tmpRoot = (prefix: string): string =>
  path.join(PACKAGE_ROOT, '.e2e-tmp', `${prefix}-${randomUUID().slice(0, 8)}`);
