/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Plugin} from 'vite';
import type {CssSheetBuild} from '../options.js';
import {resolveRuntimeModule} from './shared.js';

/**
 * `import href from './x.css?hmr-url'` — `?url` semantics with working HMR.
 * The string is a real stylesheet URL (dev-served CSS file; hashed `.css`
 * asset on build) for shadow-root `<link>` hrefs and `@import url()`s. In
 * dev, each HMR re-execution yields a freshly cache-busted href, so the
 * browser refetches the changed stylesheet; in build the `?url` asset URL
 * passes through unchanged.
 */
const CSS_URL_QUERY_RE = /^([^?]+\.css)\?(?:[^&]*&)*hmr-url(?:&.*)?$/;
const CSS_URL_VIRTUAL_PREFIX = '\0lit-plugin:hmr-url:';

/**
 * `import sheet from './x.css?css-sheet'` — a constructed, shareable
 * `CSSStyleSheet` backed by the `.css` asset that hot-swaps in place. Adopt it
 * from any number of components (`static styles = [sheet]`); a source edit
 * re-fetches and `replaceSync()`s it, updating every shadow root that adopted
 * it without re-rendering a component or reloading the page.
 *
 * This is the `urlSheet()` helper plus its irreducible HMR wiring, lifted into
 * a plugin-generated module: the `import.meta.hot.accept` lives here (where
 * Vite's static analysis sees the literal specifier), so callers write a bare
 * import and never touch `import.meta.hot` themselves.
 *
 * Under `vite build` the generated module can instead inline the css text (see
 * `cssSheetBuild`) — a library's consumers bundle its JS only, so a
 * fetch-backed sheet would 404 on the `.css` asset that never reached their
 * build.
 */
const CSS_SHEET_QUERY_RE = /^([^?]+\.css)\?(?:[^&]*&)*css-sheet(?:&.*)?$/;
const CSS_SHEET_VIRTUAL_PREFIX = '\0lit-plugin:css-sheet:';
// The virtual id must not end in `.css`, or Vite's CSS plugins (which match
// the id's extension regardless of `\0`) would compile the wrapper as CSS.
const CSS_VIRTUAL_SUFFIX = '.js';

/**
 * Import-query support, served in dev and build alike (source code using
 * `?hmr-url`/`?css-sheet` must keep working under `vite build`, where the HMR
 * plugin doesn't apply). Exported for the baseline e2e run, which needs the
 * queries working without the HMR plugin.
 *
 * `getCssSheetBuild` is a getter, not a value: `litPlugin()` re-resolves its
 * options against the loaded env in a `config` hook, which runs after the
 * plugin array is built. Standalone (no getter) it behaves like the `'auto'`
 * default.
 */
export const litCssQueries = (
  getCssSheetBuild: () => CssSheetBuild = () => 'auto'
): Plugin => {
  let isBuild = false;
  let isLib = false;
  return {
    name: 'lit-css-query',
    // Vite's core resolver claims `./x.css?hmr-url` for the CSS pipeline
    // before normal plugins get a look, so resolve ahead of it.
    enforce: 'pre',
    configResolved(config) {
      isBuild = config.command === 'build';
      isLib = config.build.lib !== false && config.build.lib !== undefined;
    },
    async resolveId(id, importer) {
      const prefix = CSS_URL_QUERY_RE.test(id)
        ? CSS_URL_VIRTUAL_PREFIX
        : CSS_SHEET_QUERY_RE.test(id)
          ? CSS_SHEET_VIRTUAL_PREFIX
          : null;
      if (prefix === null) {
        return null;
      }
      const file = id.slice(0, id.indexOf('?'));
      const resolved = await this.resolve(file, importer);
      if (resolved === null) {
        return null;
      }
      return prefix + resolved.id + CSS_VIRTUAL_SUFFIX;
    },
    load(id) {
      const helperPath = resolveRuntimeModule('css');
      if (id.startsWith(CSS_URL_VIRTUAL_PREFIX)) {
        const file = id.slice(
          CSS_URL_VIRTUAL_PREFIX.length,
          -CSS_VIRTUAL_SUFFIX.length
        );
        return {
          code:
            `import url from ${JSON.stringify(`${file}?url`)};\n` +
            `import {devCacheBust} from ${JSON.stringify(helperPath)};\n` +
            `export default devCacheBust(url);\n`,
          moduleType: 'js',
        };
      }
      if (id.startsWith(CSS_SHEET_VIRTUAL_PREFIX)) {
        const file = id.slice(
          CSS_SHEET_VIRTUAL_PREFIX.length,
          -CSS_VIRTUAL_SUFFIX.length
        );
        const mode = getCssSheetBuild();
        const inlineQuery =
          !isBuild || mode === 'url' || (mode === 'auto' && !isLib)
            ? null
            : mode === 'inline-raw'
              ? '?raw'
              : '?inline';
        if (inlineQuery !== null) {
          // Build only, so no `import.meta.hot` block. The sheet is still
          // constructed once per virtual module, so adopters share it exactly
          // as they do in the fetch-backed form.
          return {
            code:
              `import css from ${JSON.stringify(`${file}${inlineQuery}`)};\n` +
              `const sheet = new CSSStyleSheet();\n` +
              `sheet.replaceSync(css);\n` +
              `export default sheet;\n`,
            moduleType: 'js',
          };
        }
        // The accept specifier must be byte-identical to the import above —
        // Vite resolves accepted HMR deps by static analysis. Generating both
        // here is exactly what frees the caller from writing it. The swap is
        // self-accepted at this boundary, so it never propagates to adopters.
        const urlSpecifier = JSON.stringify(`${file}?url`);
        return {
          code:
            `import url from ${urlSpecifier};\n` +
            `import {urlSheet} from ${JSON.stringify(helperPath)};\n` +
            `const {sheet, onHotUpdate} = urlSheet(url);\n` +
            `export default sheet;\n` +
            `if (import.meta.hot) {\n` +
            `  import.meta.hot.accept(${urlSpecifier}, onHotUpdate);\n` +
            `}\n`,
          moduleType: 'js',
        };
      }
      return null;
    },
  };
};
