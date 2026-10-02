/**
 * A real Chrome with nothing but the page in frame, for screenshots and
 * screen recordings.
 *
 * Each launch gets a throwaway profile whose preferences are written before
 * Chrome starts: no translate bubble (this matters on a non-English system
 * locale), no password, notification or restore prompts, no first-run page,
 * no bookmark bar, and an English browser UI.
 *
 * Chrome is spawned directly and Playwright attaches over the DevTools
 * protocol, rather than `chromium.launch*()`. Playwright's launcher adds
 * flags that show up on screen (`--enable-automation` puts up the "controlled
 * by automated test software" bar, `--no-sandbox` a warning bar), passes its
 * own `--disable-features`, and rejects the bare `(en-US)` value that macOS
 * needs to switch the UI language.
 *
 * As a module:
 *
 *     import {launchCleanChrome} from './chrome-profile.mjs';
 *     const {browser, context, page, close} = await launchCleanChrome({app: url});
 *
 * As a command, it opens a window to record by hand and waits for it to close:
 *
 *     node scripts/chrome-profile.mjs http://localhost:5179/          # tabs + toolbar
 *     node scripts/chrome-profile.mjs --app http://localhost:5179/    # page only
 *     node scripts/chrome-profile.mjs --kiosk http://localhost:5179/  # full screen
 *
 * `--kiosk` also hides the macOS menu bar while Chrome is in front, which
 * only matters for full-screen captures; a window capture never includes it.
 */

import {spawn} from 'node:child_process';
import {rmSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

/** Written to `Default/Preferences` of every fresh profile. */
export const CLEAN_PREFERENCES = {
  translate: {enabled: false},
  signin: {allowed: false},
  intl: {accept_languages: 'en-US,en'},
  spellcheck: {dictionaries: ['en-US']},
  credentials_enable_service: false,
  profile: {
    exit_type: 'Normal',
    exited_cleanly: true,
    default_content_setting_values: {notifications: 2, geolocation: 2},
  },
  autofill: {profile_enabled: false, credit_card_enabled: false},
  bookmark_bar: {show_on_all_tabs: false},
  browser: {has_seen_welcome_page: true, check_default_browser: false},
  session: {restore_on_startup: 5},
  download_bubble: {partial_view_enabled: false},
  search: {suggest_enabled: false},
};

export const CLEAN_ARGS = [
  '--lang=en-US',
  // macOS ignores --lang for the browser UI; this is Cocoa's per-app override.
  // Chrome also opens the bare value as a tab, which launch closes again.
  ...(process.platform === 'darwin' ? ['-AppleLanguages', '(en-US)'] : []),
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-crash-restore-bubble',
  '--disable-session-crashed-bubble',
  '--disable-sync',
  '--disable-features=Translate,TranslateUI',
];

const CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

/** Chrome writes the port it picked for `--remote-debugging-port=0` here. */
const debuggingPort = async (dir, child) => {
  const file = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited early (code ${child.exitCode})`);
    }
    const text = await readFile(file, 'utf8').catch(() => '');
    const port = Number(text.split('\n')[0]);
    if (port > 0) return port;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Chrome did not open a debugging port');
};

/**
 * Closes the tab Chrome opens for the `(en-US)` value of `-AppleLanguages`,
 * in app mode too. It goes through the HTTP endpoint before Playwright
 * attaches: while the tab is stuck resolving `http://(en-us)/`, attaching to
 * it never finishes.
 */
const closeStrayTab = async (origin) => {
  if (process.platform !== 'darwin') return;
  // It shows up within half a second; an --app launch with a URL opens none.
  for (let i = 0; i < 15; i++) {
    const targets = await fetch(`${origin}/json/list`)
      .then((r) => r.json())
      .catch(() => []);
    const stray = targets.find(
      (t) => t.type === 'page' && /\(en-us\)|^chrome-error:/i.test(t.url)
    );
    if (stray) {
      await fetch(`${origin}/json/close/${stray.id}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/**
 * Launches installed Google Chrome on a fresh clean profile.
 *
 * - `app`: open this URL as an app window, without tab strip or omnibox.
 * - `kiosk`: full screen with no browser UI at all.
 * - `url`: a normal window opened at this URL (with `kiosk`, the page shown).
 * - `size`: window size as `[width, height]`.
 * - `executablePath`: another Chrome build; `CHROME_PATH` env works too.
 *
 * The page keeps the real window size; Playwright emulates no viewport.
 * `close()` quits Chrome and deletes the profile.
 */
export const launchCleanChrome = async ({
  app,
  kiosk = false,
  url,
  size = [1280, 800],
  args = [],
  executablePath = process.env['CHROME_PATH'] ?? CHROME_PATHS[process.platform],
} = {}) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clean-chrome-'));
  await mkdir(path.join(dir, 'Default'));
  await writeFile(
    path.join(dir, 'Default', 'Preferences'),
    JSON.stringify(CLEAN_PREFERENCES)
  );
  const child = spawn(
    executablePath,
    [
      ...CLEAN_ARGS,
      `--user-data-dir=${dir}`,
      '--remote-debugging-port=0',
      `--window-size=${size.join(',')}`,
      ...(kiosk ? ['--kiosk'] : []),
      ...args,
      app ? `--app=${app}` : (url ?? 'about:blank'),
    ],
    {stdio: 'ignore'}
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  // A caller that exits without close() still takes Chrome and the profile
  // with it.
  const onExit = () => {
    child.kill();
    // Chrome may still be writing; a leftover temp dir beats a crash here.
    try {
      rmSync(dir, {recursive: true, force: true, maxRetries: 3});
    } catch {}
  };
  process.once('exit', onExit);
  const close = async () => {
    process.off('exit', onExit);
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    await rm(dir, {recursive: true, force: true});
  };
  try {
    const origin = `http://127.0.0.1:${await debuggingPort(dir, child)}`;
    await closeStrayTab(origin);
    const browser = await chromium.connectOverCDP(origin, {timeout: 15_000});
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.newPage());
    await page.waitForLoadState();
    return {browser, context, page, close, exited, dir};
  } catch (error) {
    await close();
    throw error;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error(
      'usage: node scripts/chrome-profile.mjs [--app|--kiosk] <url>'
    );
    process.exit(1);
  }
  const app = argv.includes('--app') ? target : undefined;
  // Until launch returns, the exit hook in launchCleanChrome cleans up.
  process.on('SIGINT', () => process.exit(130));
  const {close, exited} = await launchCleanChrome({
    app,
    kiosk: argv.includes('--kiosk'),
    url: app ? undefined : target,
  });
  console.log('Clean Chrome is open; quit it (or Ctrl+C here) to finish.');
  process.removeAllListeners('SIGINT');
  process.on('SIGINT', () => close().then(() => process.exit(0)));
  await exited;
  await close();
  process.exit(0);
}
