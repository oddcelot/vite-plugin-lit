/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Browser helpers for referencing CSS files from shadow roots via Vite's
 * `?url` imports.
 *
 * A `?url` import yields a real stylesheet URL — the dev server serves the
 * file as CSS, and `vite build` emits it as a hashed `.css` asset. That
 * makes it the right base for `<link>` hrefs and `@import url()`s inside
 * shadow roots. The one gap is dev HMR: the imported URL string is identical
 * across module re-executions, so the browser would keep the stale
 * stylesheet. These helpers close that gap.
 *
 * This module is dependency-free and must stay safe to load in any
 * environment.
 */

/**
 * Vite's dev flag. Accessed as a direct member expression (`import.meta.env.DEV`)
 * so the bundler can statically replace it per key. Aliasing the whole object
 * (`const env = import.meta.env`) instead defeats that replacement and makes
 * Vite inline the ENTIRE serialized `import.meta.env` — every env var — into the
 * consumer bundle. Optional chaining keeps this safe where `import.meta.env` is
 * absent (non-Vite runtimes).
 */
const isDev = (): boolean =>
  (import.meta as {env?: {DEV?: boolean}}).env?.DEV === true;

/**
 * Appends a cache-busting query to a `?url`-imported CSS file URL in dev.
 *
 * Call this at *module scope* (not in `render()`, where every render would
 * refetch): each HMR re-execution then yields a fresh href and the browser
 * refetches the changed stylesheet.
 *
 * In production builds the URL is a content-hashed asset, so the input is
 * returned unchanged.
 *
 * @example
 * ```ts
 * import cssUrl from './my-element.css?url';
 * import {devCacheBust} from '@lit-labs/vite-plugin-lit/css.js';
 *
 * const href = devCacheBust(cssUrl); // module scope
 * html`<link rel="stylesheet" href="${href}" />`;
 * ```
 */
export const devCacheBust = (url: string): string => {
  return isDev() ? `${url}?t=${Date.now()}` : url;
};

/**
 * In dev, turns a `?url`-imported CSS path into one that fetches the
 * *compiled CSS bytes* (`text/css`). Vite serves a `?url` CSS path as a JS
 * module (`__vite__updateStyle(…)`), so a plain `fetch().text()` returns
 * JavaScript; the `direct` query makes it return the stylesheet instead,
 * pipeline-processed the same way the build asset is. In production the URL
 * is already a real `.css` asset, so it's returned unchanged.
 *
 * Joined with `?` or `&` depending on whether the URL already carries a query
 * (a freshly started dev server yields a bare path; after an HMR cache-bust
 * it carries `?t=…`).
 */
const devDirect = (url: string): string => {
  if (!isDev()) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}direct`;
};

/**
 * A shared `CSSStyleSheet` backed by a `?url` CSS asset, plus the callback to
 * hot-swap it in place. Returned by {@link urlSheet}.
 */
export interface UrlSheet {
  /**
   * The constructed stylesheet. Adopt it from any number of components
   * (`static styles = [sheet]`); an edit to the source CSS re-fetches and
   * `replaceSync()`s it, updating every shadow root that adopted it without
   * re-rendering a component or reloading the page.
   *
   * It is empty until the first fetch resolves, so expect a brief flash of
   * unstyled content on initial load — the cost of keeping the CSS as a real
   * asset rather than inlining it into the JS bundle.
   */
  sheet: CSSStyleSheet;
  /**
   * Vite HMR accept callback for the `?url` dependency. Wire it up with the
   * *same literal specifier* you imported — Vite resolves accepted deps by
   * static analysis, so the string has to appear in your module:
   *
   * ```ts
   * import.meta.hot?.accept('./utils.css?url', onHotUpdate);
   * ```
   *
   * Typed to match Vite's accept callback (`ModuleNamespace | undefined`) so
   * it drops straight in; the new module's `default` export is the updated
   * `?url` string.
   */
  onHotUpdate: (mod: Record<string, unknown> | undefined) => void;
}

/**
 * Builds a {@link UrlSheet} from a `?url`-imported CSS asset: a single
 * constructed `CSSStyleSheet`, shareable across shadow roots via
 * `adoptedStyleSheets`, that hot-swaps in place on edits — no component
 * re-render, no full-page reload.
 *
 * `?url` keeps the stylesheet as a standalone, pipeline-processed `.css` file
 * in the build output (unlike `?inline`/`?raw`, which inline it into the JS
 * chunk). The file is read into the sheet at runtime via `fetch()`, with the
 * dev/build path difference handled internally.
 *
 * @example
 * ```ts
 * import {urlSheet} from '@lit-labs/vite-plugin-lit/css.js';
 * import sheetUrl from './utils.css?url';
 *
 * const {sheet, onHotUpdate} = urlSheet(sheetUrl);
 * export default sheet; // `static styles = [sheet]` in components
 *
 * import.meta.hot?.accept('./utils.css?url', onHotUpdate);
 * ```
 */
export const urlSheet = (url: string): UrlSheet => {
  const sheet = new CSSStyleSheet();
  // Guards against out-of-order fetch resolution: two rapid edits fire
  // overlapping fetches, and a slower earlier one must not land after (and
  // clobber) a newer one. Only the most recently issued request applies.
  let latest = 0;
  const update = (next: string): Promise<void> => {
    const token = ++latest;
    return fetch(devDirect(next))
      .then((r) => r.text())
      .then((css) => {
        if (token === latest) {
          sheet.replaceSync(css);
        }
      })
      .catch(() => {});
  };
  update(url);
  return {
    sheet,
    onHotUpdate: (mod) => {
      const next = mod?.['default'];
      if (typeof next === 'string') {
        update(next);
      }
    },
  };
};
