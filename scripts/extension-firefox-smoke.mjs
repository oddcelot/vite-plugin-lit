/**
 * Smoke-tests the Firefox build of the extension in a real Firefox:
 *
 *     pnpm run extension:smoke:firefox              # build, then test
 *     pnpm run extension:smoke:firefox --no-build   # reuse the last builds
 *
 * The e2e suite drives the Chrome build through Playwright, which can't load
 * an extension into Firefox. This drives Firefox over WebDriver BiDi instead:
 * it installs `dist/extension-firefox` as a temporary add-on, serves the
 * playground's production build, enables the site through the background as
 * the popup would, reloads the page and reads the Lit tab (opened as a plain
 * tab, the panel's test seam). It checks the parts that differ from Chrome:
 * the event-page background, MAIN-world registration from it, the relay, and
 * the panel booting from the storage change.
 *
 * Not covered: the toolbar popup's click (the permission comes with the
 * manifest here) and the DevTools APIs, which need a person at DevTools.
 *
 * Needs Firefox 140+ (`FIREFOX=/path/to/firefox`; defaults to the macOS
 * Firefox Developer Edition, then Firefox). Opening extension pages isn't
 * possible over plain BiDi, so it runs with `-remote-allow-system-access`
 * and opens them from the browser window, in a throwaway profile.
 */

import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTENSION = path.join(ROOT, 'dist', 'extension-firefox');
const SITE = path.join(ROOT, 'playground', 'dist');
const UUID = '0b1e0c5e-1111-4222-8333-444455556666';
const PORT = 9333;

const FIREFOX =
  process.env['FIREFOX'] ??
  [
    '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
  ].find((candidate) => existsSync(candidate)) ??
  'firefox';

if (!process.argv.includes('--no-build')) {
  const run = (command, args, cwd = ROOT) =>
    execFileSync(command, args, {cwd, stdio: 'inherit'});
  run('pnpm', ['run', 'build:extension:firefox']);
  run('vp', ['build'], path.join(ROOT, 'playground'));
}

const {
  browser_specific_settings: {
    gecko: {id: ID},
  },
} = JSON.parse(await readFile(path.join(EXTENSION, 'manifest.json'), 'utf8'));

const TYPES = {'.js': 'text/javascript', '.css': 'text/css'};
const server = createServer(async (req, res) => {
  const file = path.join(
    SITE,
    req.url === '/' ? 'index.html' : (req.url ?? '').split('?')[0]
  );
  try {
    const body = await readFile(file);
    res.setHeader('content-type', TYPES[path.extname(file)] ?? 'text/html');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// Firefox's sites are hosts on any port; see `normalizeOrigin`.
const site = 'http://127.0.0.1';

// The build as shipped, plus the grant the user would click through.
const work = await mkdtemp(path.join(tmpdir(), 'lit-firefox-smoke-'));
const extension = path.join(work, 'extension');
await cp(EXTENSION, extension, {recursive: true});
const manifestPath = path.join(extension, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions = [`${site}/*`];
await writeFile(manifestPath, JSON.stringify(manifest));

const profile = path.join(work, 'profile');
await mkdir(profile);
await writeFile(
  path.join(profile, 'user.js'),
  [
    // A fixed moz-extension:// host, so the pages have known URLs.
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(
      JSON.stringify({[ID]: UUID})
    )});`,
    `user_pref("remote.experimental.enabled", true);`,
    `user_pref("browser.shell.checkDefaultBrowser", false);`,
    `user_pref("datareporting.policy.dataSubmissionEnabled", false);`,
  ].join('\n')
);

const firefox = spawn(
  FIREFOX,
  [
    '--headless',
    '--remote-debugging-port',
    String(PORT),
    '-remote-allow-system-access',
    '--profile',
    profile,
    '--no-remote',
  ],
  {stdio: ['ignore', 'ignore', 'pipe']}
);
let stderr = '';
firefox.stderr.on('data', (chunk) => (stderr += chunk));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: ${detail}`}`);
  if (!ok) failures.push(label);
};

let ws;
try {
  for (
    let i = 0;
    i < 100 && !stderr.includes('WebDriver BiDi listening');
    i++
  ) {
    await sleep(200);
  }
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`no BiDi on ${PORT}:\n${stderr}`));
  });
  let next = 1;
  const pending = new Map();
  ws.onmessage = ({data}) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, (m) =>
        m.type === 'error'
          ? reject(new Error(`${method}: ${m.error} ${m.message}`))
          : resolve(m.result)
      );
      ws.send(JSON.stringify({id, method, params}));
    });
  const evaluate = async (context, expression) => {
    const result = await send('script.evaluate', {
      expression,
      target: {context},
      awaitPromise: true,
    });
    if (result.type === 'exception') {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const contexts = async () =>
    (await send('browsingContext.getTree', {})).contexts;

  await send('session.new', {capabilities: {}});
  await send('webExtension.install', {
    extensionData: {type: 'path', path: extension},
  });

  const {context: page} = await send('browsingContext.create', {type: 'tab'});
  await send('browsingContext.navigate', {
    context: page,
    url: origin,
    wait: 'complete',
  });

  // BiDi won't navigate to an extension page; the browser window can.
  const [win] = (await send('browsingContext.getTree', {'moz:scope': 'chrome'}))
    .contexts;
  const open = async (file) => {
    const url = `moz-extension://${UUID}/${file}`;
    const before = new Set((await contexts()).map((c) => c.context));
    await evaluate(
      win.context,
      `gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      }); true`
    );
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      const added = (await contexts()).find(
        (c) => !before.has(c.context) && c.url.startsWith('moz-extension:')
      );
      if (added) return added.context;
    }
    throw new Error(`${file} did not open`);
  };
  const registry = async (context, type) =>
    JSON.parse(
      await evaluate(
        context,
        `chrome.runtime
          .sendMessage({type: '${type}', origin: '${origin}'})
          .then(JSON.stringify)`
      )
    );

  const extensionPage = await open('popup.html');
  const tabId = await evaluate(
    extensionPage,
    `chrome.tabs.query({url: '${site}/*'}).then(([tab]) => tab?.id)`
  );
  check('the page tab is visible to the extension', tabId !== undefined, tabId);

  const panel = await open(`panel.html?tabId=${tabId}`);
  await sleep(500);
  const status = await evaluate(
    panel,
    `document.getElementById('status').textContent`
  );
  check(
    'the Lit tab shows the site as disabled',
    status === 'disabled',
    status
  );

  const enabled = await registry(panel, 'lit:enable');
  check(
    'enabling registers the scripts for the host',
    enabled.enabled && enabled.origin === site,
    JSON.stringify(enabled)
  );
  await sleep(1000);
  check(
    'the Lit tab boots once the site is enabled',
    await evaluate(panel, `!!document.querySelector('lit-devtools-panel')`),
    'no <lit-devtools-panel>'
  );

  await send('browsingContext.reload', {context: page, wait: 'complete'});
  const wrapped = await evaluate(
    page,
    `!String(customElements.define).includes('[native code]')`
  );
  check(
    'the runtime is in the page after a reload',
    wrapped,
    'define not wrapped'
  );

  let rows = 0;
  for (let i = 0; i < 25 && rows === 0; i++) {
    await sleep(200);
    rows = await evaluate(
      panel,
      `document.querySelector('lit-devtools-panel')?.shadowRoot
        ?.querySelector('components-view')?.shadowRoot
        ?.querySelectorAll('.row').length ?? 0`
    );
  }
  check("the Lit tab lists the page's components", rows > 0, `${rows} rows`);

  await registry(panel, 'lit:disable');
} catch (error) {
  check('the run', false, error.message);
} finally {
  ws?.close();
  firefox.kill();
  server.close();
  await sleep(500);
  await rm(work, {recursive: true, force: true});
}

process.exit(failures.length === 0 ? 0 : 1);
