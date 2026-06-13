/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {urlSheet} from '@lit-labs/vite-plugin-lit/css.js';
import sheetUrl from './hmr-utility-sheet.css?url';

/**
 * A single `CSSStyleSheet` adopted by multiple components — simulates a
 * utility-first framework output (Tailwind, UnoCSS) shared across the app.
 * When the utility classes change, the sheet hot-swaps in place: every
 * adopter updates without re-rendering a single component, and without a
 * full-page reload.
 *
 * `urlSheet()` (from the plugin's CSS helpers) keeps the stylesheet as a
 * *standalone, pipeline-processed `.css` asset* in the build output — unlike
 * the `?inline`/`?raw` shared-sheet demos, which inline the CSS into the JS
 * bundle — and fetches it into the constructed sheet at runtime. The cost is
 * a brief flash of unstyled content on initial load while that fetch is in
 * flight.
 *
 * The `import.meta.hot.accept` call has to live here with the same literal
 * specifier as the import: Vite resolves accepted HMR deps by static
 * analysis, so the helper can't register it for us.
 */
const {sheet, onHotUpdate} = urlSheet(sheetUrl);

export default sheet;

if (import.meta.hot) {
  import.meta.hot.accept('./hmr-utility-sheet.css?url', onHotUpdate);
}
