/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * A page that Vite does not serve, on another origin, feeds the panel of a
 * `lit-devtools dev` process through nothing but the script tag the server
 * prints at startup.
 *
 * Worth an e2e rather than a unit test: the pieces that can break are the
 * ones only a browser and a real second origin exercise -- a classic script
 * loading cross-origin, the connection descriptor inlined so no cross-origin
 * `fetch` is needed, the WebSocket upgrade's origin check, and the runtime
 * (timeline and inspector installs) reacting to a carrier that was attached
 * after it booted rather than to Vite's HMR channel.
 *
 * Needs `pnpm run build` (the server serves `dist/standalone`).
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer, type Server} from 'node:http';
import {connect, createServer as createTcpServer} from 'node:net';
import type {AddressInfo, Server as TcpServer} from 'node:net';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium, type Browser, type Page} from 'playwright-core';
import {afterAll, beforeAll, expect, test} from 'vite-plus/test';

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

let browser: Browser;
let cli: ChildProcess;
let appServer: Server;
let proxy: TcpServer;
let proxyOrigin: string;
let workDir: string;
let devOrigin: string;
let appOrigin: string;

/** Waits for the CLI to print the script tag and returns the server origin. */
const readScriptOrigin = (child: ChildProcess): Promise<string> =>
  new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`no script tag from the CLI:\n${output}`)),
      15_000
    );
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /<script src="(http:\/\/[^"]+)\/lit-devtools\.js">/.exec(
        output
      );
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('exit', () => reject(new Error(`CLI exited:\n${output}`)));
  });

beforeAll(async () => {
  workDir = path.join(
    PACKAGE_ROOT,
    '.e2e-tmp',
    `standalone-${randomUUID().slice(0, 8)}`
  );
  await mkdir(workDir, {recursive: true});
  const entry = path.join(workDir, 'app.js');
  await writeFile(
    entry,
    `import {LitElement, html} from 'lit';
class StandaloneHello extends LitElement {
  static properties = {name: {type: String}};
  constructor() { super(); this.name = 'world'; }
  render() { return html\`hello \${this.name}\`; }
}
customElements.define('standalone-hello', StandaloneHello);
`
  );
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

  cli = spawn(
    process.execPath,
    [path.join(PACKAGE_ROOT, 'bin.mjs'), 'dev', '--no-auth', '--port', '0'],
    {cwd: PACKAGE_ROOT}
  );
  devOrigin = await readScriptOrigin(cli);

  // Not Vite: a bare static server, on its own port. The devtools script goes
  // first, as it would in a real page, so its `customElements.define` hook is
  // in place before the app defines anything.
  appServer = createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(appJs);
      return;
    }
    const via = req.url?.includes('via=proxy') ? proxyOrigin : devOrigin;
    res.setHeader('content-type', 'text/html');
    res.end(
      `<!doctype html><body>
<script src="${via}/lit-devtools.js"></script>
<script src="/app.js"></script>
<standalone-hello></standalone-hello>`
    );
  });
  await new Promise<void>((resolve) =>
    appServer.listen(0, '127.0.0.1', resolve)
  );
  appOrigin = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;

  // Stands in for StackBlitz's preview proxy, a tunnel or a reverse proxy: the
  // dev server reached at an address it does not know it has. Raw TCP, so the
  // WebSocket upgrade goes through it as well.
  const devPort = Number(new URL(devOrigin).port);
  proxy = createTcpServer((socket) => {
    const upstream = connect(devPort, 'localhost');
    socket.pipe(upstream).pipe(socket);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxyOrigin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

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
  await new Promise<void>((resolve) =>
    proxy ? proxy.close(() => resolve()) : resolve()
  );
  await rm(workDir, {recursive: true, force: true});
});

let app: Page;

test('a page outside Vite shows up in the standalone panel', async () => {
  app = await browser.newPage();
  const messages: string[] = [];
  app.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`));
  app.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  await app.goto(appOrigin);

  expect(new URL(app.url()).origin).not.toBe(new URL(devOrigin).origin);
  await expect
    .poll(() => messages.some((m) => m.includes('[lit-devtools] connected')))
    .toBe(true);
  expect(messages.filter((m) => /^(error|pageerror)/.test(m))).toEqual([]);

  const panel = await browser.newPage();
  await panel.goto(`${devOrigin}/#tab=components`);
  await panel.waitForSelector('lit-devtools-panel');
  await panel.getByText('standalone-hello').first().waitFor({timeout: 15_000});
}, 60_000);

test('the panel can record the page it never served', async () => {
  const panel = await browser.newPage();
  await panel.goto(`${devOrigin}/#tab=timeline`);
  await panel.getByRole('button', {name: /Record/}).click();
  // An update on the page is what the recording should now capture.
  await app.evaluate(() => {
    (
      document.querySelector('standalone-hello') as HTMLElement & {name: string}
    ).name = 'again';
  });
  await panel
    .locator('timeline-event-list .row')
    .first()
    .waitFor({timeout: 15_000});
}, 60_000);

test('behind a proxy the page dials the address it loaded the script from', async () => {
  const page = await browser.newPage();
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const messages: string[] = [];
  page.on('console', (msg) => messages.push(msg.text()));
  await page.goto(`${appOrigin}/?via=proxy`);
  await expect
    .poll(() => messages.some((m) => m.includes('[lit-devtools] connected')))
    .toBe(true);
  // The server inlines its own origin into the script; dialing that would
  // work here but not behind a real proxy, where it is unreachable.
  const proxyHost = new URL(proxyOrigin).host;
  expect(sockets.length).toBeGreaterThan(0);
  expect(sockets.every((url) => new URL(url).host === proxyHost)).toBe(true);
  await page.close();
}, 60_000);
