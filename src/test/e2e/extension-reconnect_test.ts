/**
 * The extension's relay outlives the two things that close a document's
 * runtime port while the document lives on: the back/forward cache (Chrome
 * closes ports of a page that enters it) and a restart of the MV3 service
 * worker. The panel must see the page come back, and the runtime must
 * announce itself again, without a reload.
 *
 * Same harness as `extension_test.ts` (unpacked build, test origin granted
 * through `host_permissions`, panel stood in for by a port opened from an
 * extension page). Needs `pnpm run build:extension`.
 */

import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {build} from 'vite';
import {
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from 'playwright-core';
import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {fsp, joinPath, tmpRoot} from './utils.js';

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    connect(info: {name: string}): {
      postMessage(message: unknown): void;
      onMessage: {addListener(callback: (message: unknown) => void): void};
      disconnect(): void;
    };
  };
  tabs: {query(info: {url: string}): Promise<Array<{id?: number}>>};
};

const DIST = decodeURIComponent(
  new URL('../../../dist/extension', import.meta.url).pathname
);

let workDir: string;
let server: Server;
let appOrigin: string;
let context: BrowserContext;
let worker: Worker;
let extensionPage: Page;

// Records `pageshow`, so the test can tell a bfcache restore from a reload.
const PROBE_JS = `window.__shows = [];
addEventListener('pageshow', (e) => window.__shows.push(e.persisted));`;

const APP_SOURCE = `import {LitElement, html} from 'lit';
class ProbeHello extends LitElement {
  render() { return html\`hello\`; }
}
customElements.define('probe-hello', ProbeHello);
`;

beforeAll(async () => {
  workDir = tmpRoot('extension-reconnect');
  await fsp.mkdir(workDir, {recursive: true});

  const entry = joinPath(workDir, 'app.js');
  await fsp.writeFile(entry, APP_SOURCE);
  const built = (await build({
    root: workDir,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {entry, formats: ['iife'], name: 'app', fileName: () => 'app.js'},
    },
  })) as unknown as Array<{output: Array<{code: string}>}>;
  const appJs = built[0].output[0].code;

  server = createServer((req, res) => {
    res.setHeader('content-security-policy', "script-src 'self'");
    if (req.url === '/probe.js' || req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(req.url === '/probe.js' ? PROBE_JS : appJs);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head>
<script src="/probe.js"></script>
<script src="/app.js"></script>
</head><body><probe-hello></probe-hello></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  appOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const extensionDir = joinPath(workDir, 'unpacked');
  await fsp.cp(DIST, extensionDir, {recursive: true});
  const manifestPath = joinPath(extensionDir, 'manifest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${appOrigin}/*`];
  await fsp.writeFile(manifestPath, JSON.stringify(manifest));

  const executablePath = process.env['HMR_E2E_EXECUTABLE'];
  context = await chromium.launchPersistentContext(
    joinPath(workDir, 'profile'),
    {
      ...(executablePath !== undefined && executablePath !== ''
        ? {executablePath}
        : {channel: 'chromium'}),
      headless: process.env['HMR_E2E_HEADED'] === undefined,
      // Playwright turns the back/forward cache off by default.
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    }
  );
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/devtools.html`);
  await extensionPage.evaluate(
    (origin) => chrome.runtime.sendMessage({type: 'lit:enable', origin}),
    appOrigin
  );
}, 60_000);

afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve()
  );
  if (workDir !== undefined) {
    await fsp.rm(workDir, {recursive: true, force: true});
  }
});

interface Message {
  channel: string;
  data?: {connected?: boolean; pageId?: string};
}

/** A panel port on the app's tab, as the DevTools panel opens it. */
const openPanel = () =>
  extensionPage.evaluate(async (origin) => {
    const [tab] = await chrome.tabs.query({url: `${origin}/*`});
    const port = chrome.runtime.connect({name: 'lit-panel'});
    const got: unknown[] = [];
    port.onMessage.addListener((message) => got.push(message));
    port.postMessage({tabId: tab.id});
    (window as unknown as {got: unknown[]}).got = got;
  }, appOrigin);

const received = (channel: string) =>
  extensionPage.evaluate(
    (channel) =>
      (window as unknown as {got: Message[]}).got.filter(
        (message) => message.channel === channel
      ),
    channel
  );
const statuses = () => received('lit-ext:page');
const pageIds = async () =>
  (await received('lit:timeline:runtime-ready')).map((m) => m.data?.pageId);
/** Resolves once the panel has heard nothing for a moment. */
const settled = async () => {
  let count = -1;
  for (;;) {
    const now = (await received('lit:timeline:runtime-ready')).length;
    if (now === count) return;
    count = now;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
};
const connected = {channel: 'lit-ext:page', data: {connected: true}};

test('a page restored from the back/forward cache reconnects its relay', async () => {
  const page = await context.newPage();
  await page.goto(appOrigin);
  await openPanel();
  await expect.poll(async () => (await pageIds()).length).toBeGreaterThan(0);
  const pageId = (await pageIds())[0];
  // The start-up announcements come in a burst; let it end before marking.
  await settled();
  const statusMark = (await statuses()).length;
  const readyMark = (await pageIds()).length;

  await page.goto(`${appOrigin}/elsewhere`);
  // A restored page fires no `load`, which Playwright would wait for.
  await page.goBack({waitUntil: 'commit'});

  // The same document came back (not a reload): its probe saw `persisted`.
  expect(
    await page.evaluate(
      () => (window as unknown as {__shows: boolean[]}).__shows
    )
  ).toEqual([false, true]);
  // Everything after the mark came from leaving and restoring the page.
  await expect.poll(async () => (await statuses()).at(-1)).toEqual(connected);
  expect((await statuses()).length).toBeGreaterThan(statusMark);
  // The runtime announced itself again, as the same page.
  await expect
    .poll(async () => (await pageIds()).length)
    .toBeGreaterThan(readyMark);
  expect((await pageIds()).at(-1)).toBe(pageId);
  await page.close();
});

test('a restarted service worker gets its page port back', async () => {
  const page = await context.newPage();
  await page.goto(appOrigin);
  // A real stop of the worker over CDP: it drops every port, as an idle
  // timeout or an update does, with no test-only code in the extension. The
  // panel's old port dies with it, so a panel opened afterwards can only be
  // told the page is connected if the page's port came back by itself.
  const cdp = await context.newCDPSession(extensionPage);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await openPanel();
  await expect.poll(async () => (await statuses()).at(-1)).toEqual(connected);
  await expect.poll(() => pageIds()).not.toHaveLength(0);
  await page.close();
});
