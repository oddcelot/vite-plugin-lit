/**
 * Try the Chrome extension by hand: a Chromium with `dist/extension` loaded,
 * DevTools open, on a production build of the playground.
 *
 *     pnpm run extension:try                        # build everything, open the playground
 *     pnpm run extension:try --no-build             # reuse the last builds
 *     pnpm run extension:try --url https://lit.dev  # any other site instead
 *
 * Playwright's own Chromium, not Chrome: branded Chrome ignores
 * `--load-extension`. Spawned directly rather than through
 * `chromium.launch*()`, which would add the automation bar and flags that
 * change what the extension sees. The profile is a throwaway, so a site
 * enabled in the Lit tab stays enabled only until Chrome closes.
 *
 * The playground build uses Lit's production condition and carries no
 * DevTools plugin: it is the page the extension exists for. Don't point
 * `--url` at a Vite dev server that runs the plugin (the playground on
 * 5179): that page already has the runtime, and enabling the extension
 * there injects a second one.
 *
 * After changing extension code, rebuild (`pnpm run build:extension`), then
 * reload the extension at `chrome://extensions` and reload the page.
 */

import {execFileSync, spawn} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {preview} from 'vite';
import {CLEAN_ARGS, CLEAN_PREFERENCES} from './chrome-profile.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTENSION = path.join(ROOT, 'dist', 'extension');
const PLAYGROUND = path.join(ROOT, 'playground');

const argv = process.argv.slice(2);
const urlIndex = argv.indexOf('--url');
const url = urlIndex === -1 ? undefined : argv[urlIndex + 1];
const build = !argv.includes('--no-build');

const run = (command, args, cwd = ROOT) =>
  execFileSync(command, args, {cwd, stdio: 'inherit'});

if (build) {
  run('pnpm', ['run', 'build']);
  run('pnpm', ['run', 'build:extension']);
  if (url === undefined) run('vp', ['build'], PLAYGROUND);
}

// `preview` serves the build output and nothing else: no transform, no
// injected runtime. The playground pins its dev port strictly; here another
// free port is fine when 4180 is taken.
const server =
  url === undefined
    ? await preview({
        root: PLAYGROUND,
        preview: {port: 4180, strictPort: false},
        logLevel: 'warn',
      })
    : undefined;
const target = url ?? server.resolvedUrls.local[0];

const profile = await mkdtemp(path.join(tmpdir(), 'lit-extension-'));
await mkdir(path.join(profile, 'Default'));
await writeFile(
  path.join(profile, 'Default', 'Preferences'),
  JSON.stringify(CLEAN_PREFERENCES)
);

// `-AppleLanguages (en-US)` would open its value as a stray tab, which only
// `chrome-profile.mjs`'s Playwright attach closes again.
const args = CLEAN_ARGS.filter(
  (arg) => arg !== '-AppleLanguages' && arg !== '(en-US)'
);

const chrome = spawn(
  chromium.executablePath(),
  [
    `--user-data-dir=${profile}`,
    ...args,
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    '--auto-open-devtools-for-tabs',
    target,
  ],
  // Chromium logs harmless GCM and font noise on stderr.
  {stdio: 'ignore'}
);

console.log(
  `\nChromium is open on ${target} with the extension loaded.\n` +
    'In DevTools, open the Lit tab and click "Enable on this site".\n' +
    'Close Chromium (or press Ctrl-C) to stop.\n'
);

const exited = new Promise((resolve) => chrome.once('exit', resolve));

// Chromium writes to its profile on the way out, so it has to be gone before
// the profile can be.
const close = async () => {
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill();
  await exited;
  await server?.close();
  await rm(profile, {recursive: true, force: true});
  process.exit(0);
};

process.on('SIGINT', () => void close());
void exited.then(close);
