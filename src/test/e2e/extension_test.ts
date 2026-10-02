/**
 * The Chrome extension, loaded unpacked, injects the Lit runtime into a page
 * it was enabled for: in the page's own world, before the page's first
 * script, and through a `script-src 'self'` CSP that would refuse the
 * `<script>` tag `lit-devtools dev` relies on.
 *
 * Worth an e2e rather than a unit test: what can break is Chrome's side of
 * it -- dynamic content-script registration, `world: 'MAIN'` at
 * `document_start`, a classic-script bundle of the runtime, the port from the
 * relay reaching the background.
 *
 * Two things stand in for the user. The host permission the panel would
 * request on a click (a browser prompt automation cannot answer) is granted
 * by copying the build and listing the test origin under `host_permissions`;
 * everything after the grant runs as shipped. And the panel's runtime
 * messages and port are sent from an extension page the test opens, since
 * DevTools itself is not scriptable here: `devtools.html` is that page, whose
 * own script fails outside DevTools, which does not matter. The Lit tab
 * itself, `panel.html`, is opened the same way, in a tab, told which tab it
 * inspects by the `?tabId=` seam `panel.ts` keeps for this.
 *
 * Extensions need Playwright's Chromium (`channel: 'chromium'`, which also
 * runs them headless): Chrome-branded builds ignore `--load-extension`.
 *
 * Needs `pnpm run build:extension` (it loads `dist/extension`).
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

// The extension page's `chrome`, as far as the callbacks below use it.
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

const CSP = "script-src 'self'";

let workDir: string;
let server: Server;
let appOrigin: string;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let extensionPage: Page;

// Runs first in <head>, under the page's CSP like every page script: notes
// whether something had already replaced `customElements.define` and
// published the runtime's page channel by the time the page started.
const PROBE_JS = `window.__probe = {
  defineWrapped: !Function.prototype.toString
    .call(customElements.define)
    .includes('[native code]'),
  channel: Symbol.for('@oddsquad/vite-plugin-lit#page-channel') in globalThis,
};`;

const APP_SOURCE = `import {LitElement, html} from 'lit';
class ProbeHello extends LitElement {
  render() { return html\`hello\`; }
}
customElements.define('probe-hello', ProbeHello);
`;

beforeAll(async () => {
  workDir = tmpRoot('extension');
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
    res.setHeader('content-security-policy', CSP);
    if (req.url === '/probe.js' || req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(req.url === '/probe.js' ? PROBE_JS : appJs);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head>
<script src="/probe.js"></script>
<script>window.__inline = true;</script>
<script src="/app.js"></script>
</head><body><probe-hello></probe-hello></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  appOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The build as shipped, plus the grant the user would click through.
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
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    }
  );
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/devtools.html`);
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

/** Sends a registry message the way the panel does. */
const registry = (type: 'lit:enable' | 'lit:disable' | 'lit:status') =>
  extensionPage.evaluate(
    ([type, origin]) => chrome.runtime.sendMessage({type, origin}),
    [type, appOrigin] as const
  );

interface Probe {
  defineWrapped: boolean;
  channel: boolean;
}

const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as {__probe: Probe}).__probe);

test('nothing is injected until the site is enabled', async () => {
  expect(await registry('lit:status')).toEqual({
    origin: appOrigin,
    enabled: false,
    permitted: true,
  });
  const page = await context.newPage();
  await page.goto(appOrigin);
  expect(await probe(page)).toEqual({defineWrapped: false, channel: false});
  await page.close();
});

test('once enabled, the runtime is in the page before its first script', async () => {
  expect(await registry('lit:enable')).toEqual({
    origin: appOrigin,
    enabled: true,
    permitted: true,
  });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(appOrigin);

  expect(await probe(page)).toEqual({defineWrapped: true, channel: true});
  // The CSP is in force: the page's own inline script was refused.
  expect(await page.evaluate(() => 'inline' in window)).toBe(false);
  // The page's Lit went through the wrapped define: its shared update
  // lifecycle carries the timeline's brand.
  expect(
    await page.evaluate(() => {
      const brand = Symbol.for('@oddsquad/vite-plugin-lit#timeline-lifecycle');
      const el = document.querySelector('probe-hello') as unknown as Record<
        string,
        unknown
      >;
      const performUpdate = el['performUpdate'] as Record<symbol, unknown>;
      return performUpdate[brand];
    })
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.close();
});

test("the page's runtime reaches a panel through the relay, per document", async () => {
  const page = await context.newPage();
  await page.goto(appOrigin);
  type Message = {
    channel: string;
    data?: {connected?: boolean; pageId?: string};
  };
  // A panel opens after the page booted, as it usually does: the page has to
  // re-announce itself through MAIN world, window, relay and background.
  const openPanel = (name: string) =>
    extensionPage.evaluate(
      async ([origin, name]) => {
        const [tab] = await chrome.tabs.query({url: `${origin}/*`});
        const w = window as unknown as {
          panels: Record<string, {port: {disconnect(): void}; got: unknown[]}>;
        };
        w.panels ??= {};
        const port = chrome.runtime.connect({name: 'lit-panel'});
        const got: unknown[] = [];
        port.onMessage.addListener((message) => got.push(message));
        port.postMessage({tabId: tab.id});
        w.panels[name] = {port, got};
      },
      [appOrigin, name] as const
    );
  const closePanel = (name: string) =>
    extensionPage.evaluate((name) => {
      const w = window as unknown as {
        panels: Record<string, {port: {disconnect(): void}}>;
      };
      w.panels[name]?.port.disconnect();
    }, name);
  const received = (name: string, channel: string) =>
    extensionPage.evaluate(
      ([name, channel]) =>
        (
          window as unknown as {panels: Record<string, {got: Message[]}>}
        ).panels[name]!.got.filter((message) => message.channel === channel),
      [name, channel] as const
    );
  const statuses = (name: string) => received(name, 'lit-ext:page');
  const readies = (name: string) =>
    received(name, 'lit:timeline:runtime-ready');
  const connected = {channel: 'lit-ext:page', data: {connected: true}};

  await openPanel('first');
  await expect.poll(() => statuses('first')).toEqual([connected]);
  await expect
    .poll(async () => (await readies('first')).length)
    .toBeGreaterThan(0);
  const firstPageId = (await readies('first'))[0]?.data?.pageId;
  expect(firstPageId).toBeTypeOf('string');

  // DevTools closed and opened again on the same document. Its start-up
  // traffic is long gone, so only the re-announce can reach this panel.
  await closePanel('first');
  await openPanel('second');
  await expect
    .poll(async () => (await readies('second')).map((m) => m.data?.pageId))
    .toContain(firstPageId);

  // A reload is a new document with a new port and a new page id; the panel
  // keeps its own port.
  await page.reload();
  await expect
    .poll(async () => (await statuses('second')).at(-1))
    .toEqual(connected);
  expect((await statuses('second')).length).toBeGreaterThan(1);
  await expect
    .poll(async () => (await readies('second')).at(-1)?.data?.pageId)
    .not.toBe(firstPageId);

  await page.close();
  await expect
    .poll(async () => (await statuses('second')).at(-1))
    .toEqual({channel: 'lit-ext:page', data: {connected: false}});
});

test("the Lit tab shows the page's components, picks, and follows a reload", async () => {
  const page = await context.newPage();
  await page.goto(appOrigin);
  const tabId = await extensionPage.evaluate(
    async (origin) => (await chrome.tabs.query({url: `${origin}/*`}))[0]?.id,
    appOrigin
  );
  expect(tabId).toBeTypeOf('number');

  // The panel as DevTools would host it, in a tab of its own (see panel.ts
  // for the `tabId` seam). Anything it fails to load, or the extension's CSP
  // refuses, surfaces as a console error or a failed request.
  const panel = await context.newPage();
  const problems: string[] = [];
  panel.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  panel.on('pageerror', (error) => problems.push(error.message));
  panel.on('requestfailed', (request) =>
    problems.push(`${request.url()}: ${request.failure()?.errorText}`)
  );
  await panel.goto(
    `chrome-extension://${extensionId}/panel.html?tabId=${tabId}#tab=components`
  );
  const rows = panel.locator('components-view .row').filter({
    hasText: 'probe-hello',
  });
  await rows.first().waitFor({timeout: 15_000});
  await expect
    .poll(() => panel.locator('#page').textContent())
    .toContain('Lit runtime connected');

  // Pick: the panel's toggle reaches the page's picker through the port, and
  // the pick comes back the same way and selects the element.
  await panel.locator('components-view wa-button.pick').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.head.querySelectorAll('style')].some((s) =>
          s.textContent?.includes('crosshair')
        )
      )
    )
    .toBe(true);
  const box = (await page.locator('probe-hello').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Past the picker's hover throttle.
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await panel
    .locator('components-view .row.selected')
    .filter({hasText: 'probe-hello'})
    .waitFor({timeout: 10_000});

  // A reload is a new document; the panel follows it. A second element added
  // to the new document shows up, so the tree is the new page's, live.
  await page.reload();
  await expect
    .poll(() => panel.locator('#page').textContent())
    .toContain('Lit runtime connected');
  await page.evaluate(() =>
    document.body.append(document.createElement('probe-hello'))
  );
  await expect.poll(() => rows.count(), {timeout: 15_000}).toBe(2);

  expect(problems).toEqual([]);
  await panel.close();
  await page.close();
}, 60_000);

test('the Lit tab leaves out what needs a dev server', async () => {
  const page = await context.newPage();
  await page.goto(appOrigin);
  const tabId = await extensionPage.evaluate(
    async (origin) => (await chrome.tabs.query({url: `${origin}/*`}))[0]?.id,
    appOrigin
  );
  const panel = await context.newPage();
  await panel.goto(
    `chrome-extension://${extensionId}/panel.html?tabId=${tabId}#tab=components`
  );
  await panel
    .locator('components-view .row')
    .filter({hasText: 'probe-hello'})
    .first()
    .click({timeout: 15_000});
  // Details shown, and no source link: no transform stamped one, and there
  // is no editor to open it in.
  await panel.locator('components-view .details h2').waitFor();
  expect(await panel.locator('components-view .src').count()).toBe(0);

  // No disk to write a snapshot to, so no button that could only fail.
  await panel.locator('timeline-view wa-button.record').waitFor({
    state: 'attached',
  });
  expect(await panel.locator('timeline-view wa-button.export').count()).toBe(0);

  // The Settings tab says why the plugin settings are missing.
  await panel.locator('segmented-tabs').getByText('Settings').click();
  await expect
    .poll(() => panel.locator('devtools-settings .empty').textContent())
    .toBe(
      'Plugin settings need the Vite plugin; this page is inspected without a Vite dev server.'
    );

  await panel.close();
  await page.close();
}, 60_000);

test('disabling stops the injection', async () => {
  expect(await registry('lit:disable')).toEqual({
    origin: appOrigin,
    enabled: false,
    permitted: true,
  });
  const page = await context.newPage();
  await page.goto(appOrigin);
  expect(await probe(page)).toEqual({defineWrapped: false, channel: false});
  await page.close();
});
