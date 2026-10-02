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
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
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
let cliHome: string;
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
  // The CLI keeps the panel's per-user settings in `<home>/.lit/devframe` and
  // registers itself under `<home>/.devframe/instances` (devframe reads
  // `$HOME` on each call), so give it a throwaway home rather than the
  // developer's. Chromium below keeps the real one.
  cliHome = `${workDir}-home`;
  await mkdir(cliHome, {recursive: true});
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
    {cwd: PACKAGE_ROOT, env: {...process.env, HOME: cliHome}}
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
  await rm(cliHome, {recursive: true, force: true});
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

test('Pick picks on the page and raises a panel on the element', async () => {
  // A panel opened by hand, as the printed URL invites.
  const panel = await browser.newPage();
  await panel.goto(`${devOrigin}/#tab=components`);
  await panel.getByText('standalone-hello').first().waitFor({timeout: 15_000});

  const picking = () =>
    app.evaluate(() =>
      [...document.head.querySelectorAll('style')].some((s) =>
        s.textContent?.includes('crosshair')
      )
    );
  const pickHello = async () => {
    await panel.locator('components-view wa-button.pick').click();
    // The toggle goes panel -> server -> page; the picker is up once the
    // page has its crosshair cursor.
    await expect.poll(picking).toBe(true);
    const box = (await app.locator('standalone-hello').boundingBox())!;
    await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Past the picker's hover throttle.
    await app.waitForTimeout(150);
    await app.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };

  // No source metadata outside Vite: any Lit element is pickable.
  const popup = app.waitForEvent('popup');
  await pickHello();
  const raised = await popup;
  expect(new URL(raised.url()).hash).toMatch(/^#tab=components&component=\d+$/);
  await raised
    .locator('components-view .row.selected')
    .getByText('standalone-hello')
    .waitFor({timeout: 15_000});
  // The hand-opened panel follows the pick over RPC, as under Vite.
  await panel
    .locator('components-view .row.selected')
    .getByText('standalone-hello')
    .waitFor();

  // A second pick finds the raised panel by name instead of opening another.
  const pages = app.context().pages().length;
  await pickHello();
  await app.waitForTimeout(500);
  expect(app.context().pages().length).toBe(pages);
  await raised.close();
  await panel.close();
}, 60_000);

test('the panel can record the page it never served', async () => {
  const panel = await browser.newPage();
  await panel.goto(`${devOrigin}/#tab=timeline`);
  await panel.getByRole('button', {name: /Record/}).click();
  // An update on the page is what the recording should now capture. The
  // click only reaches the page by way of the server, so keep updating until
  // one lands after recording did, rather than racing the first.
  let n = 0;
  await expect
    .poll(
      async () => {
        await app.evaluate((name) => {
          (
            document.querySelector('standalone-hello') as HTMLElement & {
              name: string;
            }
          ).name = name;
        }, `again-${n++}`);
        return panel.locator('timeline-event-list .row').count();
      },
      {timeout: 15_000}
    )
    .toBeGreaterThan(0);
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

test('a panel setting survives a reload of the page it never served', async () => {
  const page = await browser.newPage();
  await page.goto(appOrigin);

  // The page's localStorage is on another origin than the panel's, so the
  // override the panel sets can only come back through the server's store.
  const panel = await browser.newPage();
  await panel.goto(`${devOrigin}/`);
  await panel.waitForSelector('lit-devtools-panel');
  const flash = panel.locator('components-view wa-button.flash');
  await flash.click();
  await expect.poll(() => flash.getAttribute('class')).toContain('active');
  // Durable once the server's store file has it (written after a debounce).
  const store = path.join(cliHome, '.lit', 'devframe', 'settings', 'lit.json');
  await expect
    .poll(() => readFile(store, 'utf8').catch(() => ''))
    .toContain('flashUpdates');

  await page.reload();
  const box = page.locator('[data-lit-devtools-flash]');
  // Keep updating until the replayed override reaches the runtime: the
  // connection is up some time after the reload, and the first renders
  // may have run before it. Without the replay no box ever appears.
  await expect
    .poll(
      async () => {
        await page.evaluate(async () => {
          const el = document.querySelector('standalone-hello') as
            | (HTMLElement & {
                requestUpdate(): void;
                updateComplete: Promise<unknown>;
              })
            | null;
          el?.requestUpdate();
          await el?.updateComplete;
        });
        return box.count();
      },
      {timeout: 15_000}
    )
    .toBeGreaterThan(0);
  await panel.close();
  await page.close();
}, 60_000);
