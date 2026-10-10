/**
 * The standalone script tag against a minified production build of Lit.
 *
 * `standalone-connect_test.ts` attaches to an unminified app, where every
 * name the runtime looks for still exists. A real production page differs in
 * ways only a browser shows: Lit's `production` export condition (no dev-mode
 * warnings, no `lit-debug` events, mangled private names such as the
 * controller set) and a minifier that renames the app's own classes. This
 * pins down what still works there, and what is expected to stay empty.
 *
 * Needs `pnpm run build` (the server serves `dist/standalone`).
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium, type Browser, type Page} from 'playwright-core';
import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {readScriptOrigin} from './utils.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

let browser: Browser;
let cli: ChildProcess;
let appServer: Server;
let workDir: string;
let cliHome: string;
let devOrigin: string;
let appOrigin: string;
let appJs: string;

beforeAll(async () => {
  workDir = path.join(
    PACKAGE_ROOT,
    '.e2e-tmp',
    `standalone-prod-${randomUUID().slice(0, 8)}`
  );
  await mkdir(workDir, {recursive: true});
  cliHome = `${workDir}-home`;
  await mkdir(cliHome, {recursive: true});
  const entry = path.join(workDir, 'app.js');
  // A property, a plain controller and a `@lit/task`: the shapes the
  // inspector reads off a component by name or by Lit's private fields.
  await writeFile(
    entry,
    `import {LitElement, html} from 'lit';
import {Task} from '@lit/task';
class Ticker {
  constructor(host) { this.count = 0; host.addController(this); }
  hostConnected() {}
}
class ProdHello extends LitElement {
  static properties = {name: {type: String}};
  ticker = new Ticker(this);
  loader = new Task(this, {task: async () => 'loaded', args: () => []});
  constructor() { super(); this.name = 'world'; }
  render() { return html\`hello \${this.name}\`; }
}
customElements.define('prod-hello', ProdHello);
`
  );
  // Vitest sets NODE_ENV=test, which Vite resolves like development and so
  // picks Lit's `development` export condition; a real `vite build` does not.
  // The default build: Vite resolves Lit's `production` condition and
  // minifies, as `vite build` does for an app. No plugin, no transforms.
  const nodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  let built: Array<{output: Array<{code: string}>}>;
  try {
    built = (await build({
      root: workDir,
      configFile: false,
      logLevel: 'silent',
      mode: 'production',
      build: {
        write: false,
        minify: true,
        lib: {entry, formats: ['iife'], name: 'app', fileName: () => 'app.js'},
      },
    })) as unknown as Array<{output: Array<{code: string}>}>;
  } finally {
    process.env['NODE_ENV'] = nodeEnv;
  }
  appJs = built[0].output[0].code;
  // Guards the premise: Lit's dev build announces itself, the production one
  // does not, and a minified class name is gone.
  expect(appJs).not.toContain('Lit is in dev mode');
  expect(appJs).not.toContain('class ProdHello');

  cli = spawn(
    process.execPath,
    [path.join(PACKAGE_ROOT, 'bin.mjs'), 'dev', '--no-auth', '--port', '0'],
    {cwd: PACKAGE_ROOT, env: {...process.env, HOME: cliHome}}
  );
  devOrigin = await readScriptOrigin(cli);

  appServer = createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(appJs);
      return;
    }
    res.setHeader('content-type', 'text/html');
    // `?csp` is a page that only trusts its own origin for scripts.
    const csp = req.url?.includes('csp')
      ? `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`
      : '';
    res.end(
      `<!doctype html><head>${csp}</head><body>
<script src="${devOrigin}/lit-devtools.js"></script>
<script src="/app.js"></script>
<prod-hello></prod-hello>`
    );
  });
  await new Promise<void>((resolve) =>
    appServer.listen(0, '127.0.0.1', resolve)
  );
  appOrigin = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;

  const executablePath = process.env['HMR_E2E_EXECUTABLE'];
  browser = await chromium.launch({
    ...(executablePath !== undefined && executablePath !== ''
      ? {executablePath}
      : {channel: 'chrome'}),
    headless: process.env['HMR_E2E_HEADED'] === undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  cli?.kill();
  await new Promise<void>((resolve) =>
    appServer ? appServer.close(() => resolve()) : resolve()
  );
  await rm(workDir, {recursive: true, force: true});
  await rm(cliHome, {recursive: true, force: true});
});

let app: Page;
let panel: Page;

test('the tree and inspector show a minified production component', async () => {
  app = await browser.newPage();
  const messages: string[] = [];
  app.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`));
  app.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  await app.goto(appOrigin);
  await expect
    .poll(() => messages.some((m) => m.includes('[lit-devtools] connected')))
    .toBe(true);
  expect(messages.filter((m) => /^(error|pageerror)/.test(m))).toEqual([]);

  panel = await browser.newPage();
  await panel.goto(`${devOrigin}/#tab=components`);
  await panel.getByText('prod-hello').first().waitFor({timeout: 15_000});
  await panel.getByText('prod-hello').first().click();

  const details = panel.locator('components-view .details');
  await details.getByText('Properties').waitFor({timeout: 15_000});
  // The reactive property, by its declared name.
  await details.locator('.entry .name', {hasText: 'name'}).waitFor();
  await details.locator('.entry .val', {hasText: '"world"'}).waitFor();
  // Lit's controller set is a mangled private field in the production build;
  // the plain controller and the task are still found through it.
  await details
    .locator('.entry', {hasText: 'ticker'})
    .getByText('controller')
    .waitFor();
  const loader = details.locator('.entry', {hasText: 'loader'});
  await loader.getByText('task').waitFor();
  await loader.getByText('complete').waitFor();
}, 60_000);

test('the lifecycle layer records updates, the render layers stay empty', async () => {
  // This reads the list; the Timeline opens in Tracks. The panel is already
  // on this origin, so the hash change below needs a reload to apply it.
  await panel.evaluate(() =>
    localStorage.setItem('lit-devtools-timeline-mode', 'list')
  );
  await panel.goto(`${devOrigin}/#tab=timeline`);
  await panel.reload();
  await panel.getByRole('button', {name: /Record/}).click();
  let n = 0;
  await expect
    .poll(
      async () => {
        await app.evaluate((name) => {
          (
            document.querySelector('prod-hello') as HTMLElement & {
              name: string;
            }
          ).name = name;
        }, `again-${n++}`);
        return panel.locator('timeline-event-list .row').count();
      },
      {timeout: 15_000}
    )
    .toBeGreaterThan(0);
  // The list folds each update's phases under its performUpdate row.
  await panel.locator('timeline-event-list .expand-all').click();
  const rows = await panel.locator('timeline-event-list .row').allInnerTexts();
  const titles = rows.map((row) => row.split('\n')[1]);
  // The prototype wrapping survives minification: Lit's own method names are
  // public API and stay.
  expect(titles).toContain('performUpdate');
  expect(titles).toContain('updated');
  // Lit's production build never dispatches `lit-debug`, so nothing feeds
  // the render layers.
  expect(titles.filter((t) => t.startsWith('render'))).toEqual([]);
}, 60_000);

test('a strict CSP on the page blocks the cross-origin script tag', async () => {
  const page = await browser.newPage();
  const messages: string[] = [];
  page.on('console', (msg) => messages.push(msg.text()));
  await page.goto(`${appOrigin}/?csp`);
  await expect
    .poll(() => messages.some((m) => m.includes('Content Security Policy')))
    .toBe(true);
  await page.waitForTimeout(500);
  expect(messages.some((m) => m.includes('[lit-devtools] connected'))).toBe(
    false
  );
  await page.close();
}, 60_000);
