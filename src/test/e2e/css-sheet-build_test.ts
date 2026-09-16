/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, preview, type PreviewServer} from 'vite';
import {chromium, type Browser} from 'playwright-core';
import {afterAll, expect, test} from 'vitest';
import {litPlugin, type LitPluginOptions} from '../../index.js';

/**
 * Proves the build-time half of `?css-sheet` (`cssSheetBuild`). Under
 * `build.lib` the fetch-backed form is a trap: consumers bundle the library's
 * JS only, the emitted `.css` asset never reaches their build, and the runtime
 * fetch 404s into a silently empty sheet. So a lib build inlines the css text
 * by default, and `'url'` opts back out.
 *
 * These are `vite build` runs, not dev-server runs — the plugin's HMR half
 * (`apply: 'serve'`) is inert here by construction.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** `.chip` background, distinctive enough to spot in a bundled chunk. */
const CHIP_CSS = '.chip {\n  background: rgb(59, 130, 246);\n}\n';

/**
 * Two modules importing the same `?css-sheet` file, both re-exported — the
 * shared-sheet claim needs two independent importers to be worth anything.
 */
const LIB_SOURCES: Record<string, string> = {
  'mod-a.js': `import sheet from './sheet.css?css-sheet';\nexport const a = sheet;\n`,
  'mod-b.js': `import sheet from './sheet.css?css-sheet';\nexport const b = sheet;\n`,
  'entry.js': `export {a} from './mod-a.js';\nexport {b} from './mod-b.js';\n`,
};

interface BuiltLib {
  root: string;
  dist: string;
  /** File names emitted into `dist`. */
  emitted: string[];
  /** Name of the single emitted JS chunk. */
  chunkName: string;
  /** Source of that chunk. */
  chunk: string;
}

const roots: string[] = [];
let browser: Browser | undefined;
const previews: PreviewServer[] = [];

afterAll(async () => {
  await browser?.close();
  for (const server of previews) {
    await server.close();
  }
  await Promise.all(
    roots.map((root) => rm(root, {recursive: true, force: true}))
  );
});

/**
 * Writes a throwaway lib-mode fixture and runs `vite build` over it.
 * `minify: false` keeps the emitted css text greppable.
 */
const buildLib = async (
  css: string,
  options: {plugin?: LitPluginOptions; lightningcss?: boolean} = {}
): Promise<BuiltLib> => {
  // Inside the package, like the dev fixtures: bare imports resolve by walking
  // up to the repo-root node_modules, which the OS tmpdir would break.
  const root = path.join(
    PACKAGE_ROOT,
    '.e2e-tmp',
    `build-${randomUUID().slice(0, 8)}`
  );
  roots.push(root);
  await mkdir(root, {recursive: true});
  await writeFile(path.join(root, 'package.json'), '{"type": "module"}\n');
  await writeFile(path.join(root, 'sheet.css'), css);
  for (const [name, code] of Object.entries(LIB_SOURCES)) {
    await writeFile(path.join(root, name), code);
  }

  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [litPlugin(options.plugin ?? {})],
    ...(options.lightningcss === true
      ? {css: {transformer: 'lightningcss' as const}}
      : {}),
    build: {
      minify: false,
      lib: {entry: 'entry.js', formats: ['es'], fileName: 'lib'},
    },
  });

  const dist = path.join(root, 'dist');
  const emitted = (await readdir(dist, {recursive: true})).map((p) =>
    p.split(path.sep).join('/')
  );
  const chunkName = emitted.find((f) => /\.m?js$/.test(f));
  if (chunkName === undefined) {
    throw new Error(`no JS chunk emitted: ${emitted.join(', ')}`);
  }
  return {
    root,
    dist,
    emitted,
    chunkName,
    chunk: await readFile(path.join(dist, chunkName), 'utf8'),
  };
};

/**
 * Serves a built fixture and imports its chunk in a real browser — the sheet
 * is constructed at module scope, so importing it is the whole test.
 */
const inspectSheets = async (
  built: BuiltLib
): Promise<{
  error?: string;
  isSheet?: boolean;
  shared?: boolean;
  rules?: string[];
  chipBackground?: string;
}> => {
  await writeFile(
    path.join(built.dist, 'index.html'),
    `<!doctype html>\n<div class="chip"></div>\n<script type="module">\n` +
      `try {\n` +
      `  const {a, b} = await import('./${built.chunkName}');\n` +
      `  document.adoptedStyleSheets = [a];\n` +
      `  window.__result = {\n` +
      `    isSheet: a instanceof CSSStyleSheet,\n` +
      `    shared: a === b,\n` +
      `    rules: Array.from(a.cssRules, (r) => r.cssText),\n` +
      `    chipBackground: getComputedStyle(\n` +
      `      document.querySelector('.chip')\n` +
      `    ).backgroundColor,\n` +
      `  };\n` +
      `} catch (e) {\n` +
      `  window.__result = {error: String(e)};\n` +
      `}\n</script>\n`
  );

  const server = await preview({
    root: built.root,
    configFile: false,
    logLevel: 'silent',
    build: {outDir: 'dist'},
    preview: {host: '127.0.0.1', port: 0},
  });
  previews.push(server);
  const address = server.httpServer.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('preview server has no address');
  }

  const executablePath = process.env['HMR_E2E_EXECUTABLE'];
  browser ??= await chromium.launch({
    ...(executablePath !== undefined && executablePath !== ''
      ? {executablePath}
      : {channel: 'chrome'}),
    headless: process.env['HMR_E2E_HEADED'] === undefined,
  });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(
      () => (window as {__result?: unknown}).__result !== undefined
    );
    return await page.evaluate(
      () => (window as {__result?: unknown}).__result as Record<string, never>
    );
  } finally {
    await page.close();
  }
};

test('a lib build inlines ?css-sheet into the JS chunk by default', async () => {
  const built = await buildLib(CHIP_CSS);

  // The css text rides along in the chunk, constructed at module scope — no
  // `urlSheet()` helper, so nothing fetches anything at runtime.
  expect(built.chunk).toContain('replaceSync');
  expect(built.chunk).toContain('.chip');
  expect(built.chunk).not.toContain('urlSheet');
  // Nothing references `?url` anymore, so no standalone asset is emitted —
  // the whole point: a consumer bundling only our JS would never get it.
  expect(built.emitted.filter((f) => f.endsWith('.css'))).toEqual([]);

  const result = await inspectSheets(built);
  expect(result.error).toBeUndefined();
  expect(result.isSheet).toBe(true);
  // One virtual module per resolved css file, so both importers hold the same
  // object — matching dev semantics, where that's what makes a hot swap reach
  // every adopter.
  expect(result.shared).toBe(true);
  expect(result.rules?.join('\n')).toContain('rgb(59, 130, 246)');
  expect(result.chipBackground).toBe('rgb(59, 130, 246)');
});

test(`cssSheetBuild: 'url' restores the asset-emitting form`, async () => {
  const built = await buildLib(CHIP_CSS, {plugin: {cssSheetBuild: 'url'}});

  // Fetch-backed: the helper is bundled, the css text is not, and the sheet's
  // bytes live in a standalone asset the app is expected to serve.
  expect(built.chunk).toContain('urlSheet');
  expect(built.chunk).not.toContain('.chip');
  expect(built.emitted.filter((f) => f.endsWith('.css'))).not.toEqual([]);
});

test(`cssSheetBuild: 'inline-raw' skips a css pipeline that rejects the source`, async () => {
  // Spec-invalid but shipped in the wild: `initial-value` can't hold a `var()`,
  // and Lightning CSS refuses the whole file over it.
  const css =
    `@property --chip-bg {\n` +
    `  syntax: '<color>';\n` +
    `  inherits: false;\n` +
    `  initial-value: var(--brand);\n` +
    `}\n` +
    CHIP_CSS;

  await expect(
    buildLib(css, {plugin: {cssSheetBuild: 'inline'}, lightningcss: true})
  ).rejects.toThrow();

  const built = await buildLib(css, {
    plugin: {cssSheetBuild: 'inline-raw'},
    lightningcss: true,
  });
  // Verbatim: the rule the pipeline choked on is in the chunk as authored.
  expect(built.chunk).toContain('initial-value: var(--brand)');
  expect(built.chunk).toContain('replaceSync');
  expect(built.chunk).not.toContain('urlSheet');
  expect(built.emitted.filter((f) => f.endsWith('.css'))).toEqual([]);
});
