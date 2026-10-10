/**
 * The runtime's own Lit does not count as a duplicate copy.
 *
 * The extension's page script and `lit-devtools.js` bundle the element
 * picker, a LitElement, and so a private lit-html / lit-element /
 * reactive-element. Each pushes its version onto the page's
 * `litHtmlVersions` lists, which the inspector reports as "duplicate copies".
 * A page with exactly one Lit of its own must show exactly one entry per list,
 * whichever of the two scripts runs.
 *
 * Needs `pnpm run build` and `pnpm run build:extension`.
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium, type BrowserContext, type Page} from 'playwright-core';
import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {fsp, joinPath, readScriptOrigin, tmpRoot} from './utils.js';

declare const chrome: {
  runtime: {sendMessage(message: unknown): Promise<unknown>};
};

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIST = joinPath(PACKAGE_ROOT, 'dist', 'extension');

const APP_SOURCE = `import {LitElement, html} from 'lit';
class OwnLitHello extends LitElement {
  render() { return html\`hello\`; }
}
customElements.define('own-lit-hello', OwnLitHello);
`;

let workDir: string;
let server: Server;
let appOrigin: string;
let context: BrowserContext;
let cli: ChildProcess;
let devOrigin: string;

const listsOf = (page: Page) =>
  page.evaluate(() => {
    const g = globalThis as unknown as Record<string, string[] | undefined>;
    return {
      html: g['litHtmlVersions']?.length,
      element: g['litElementVersions']?.length,
      reactive: g['reactiveElementVersions']?.length,
    };
  });

beforeAll(async () => {
  workDir = tmpRoot('own-lit');
  await fsp.mkdir(joinPath(workDir, 'home'), {recursive: true});
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

  cli = spawn(
    process.execPath,
    [joinPath(PACKAGE_ROOT, 'bin.mjs'), 'dev', '--no-auth', '--port', '0'],
    {
      cwd: PACKAGE_ROOT,
      env: {...process.env, HOME: joinPath(workDir, 'home')},
    }
  );
  devOrigin = await readScriptOrigin(cli);

  server = createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(appJs);
      return;
    }
    res.setHeader('content-type', 'text/html');
    // `?standalone` loads the dev server's script before the app, as its
    // docs say to; otherwise the extension is the only runtime.
    const tag = req.url?.includes('standalone')
      ? `<script src="${devOrigin}/lit-devtools.js"></script>`
      : '';
    res.end(`<!doctype html><html><head>${tag}
<script src="/app.js"></script>
</head><body><own-lit-hello></own-lit-hello></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
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
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    }
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionPage = await context.newPage();
  await extensionPage.goto(
    `chrome-extension://${new URL(worker.url()).host}/devtools.html`
  );
  await extensionPage.evaluate(
    (origin) => chrome.runtime.sendMessage({type: 'lit:enable', origin}),
    appOrigin
  );
}, 60_000);

afterAll(async () => {
  await context?.close();
  cli?.kill();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve()
  );
  if (workDir !== undefined) {
    await fsp.rm(workDir, {recursive: true, force: true});
  }
});

const ONE = {html: 1, element: 1, reactive: 1};

test("the extension's own Lit is not a duplicate of the page's", async () => {
  const page = await context.newPage();
  await page.goto(appOrigin);
  expect(await listsOf(page)).toEqual(ONE);
  await page.close();
});

test("lit-devtools.js's own Lit is not a duplicate of the page's", async () => {
  // `localhost` is not the origin the extension was enabled for, so only the
  // script tag runs here.
  const page = await context.newPage();
  await page.goto(`${appOrigin.replace('127.0.0.1', 'localhost')}/?standalone`);
  expect(await listsOf(page)).toEqual(ONE);
  await page.close();
});
