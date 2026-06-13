/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import rawCss from './hmr-shared.css?raw';

/**
 * A single `CSSStyleSheet` adopted by both `hmr-shared-css-a` and
 * `hmr-shared-css-b`. When the CSS file changes, this module handles HMR
 * directly — it calls `replaceSync()` on the existing sheet, which updates
 * all shadow roots that adopted it. The component modules are never
 * re-executed, so their state and DOM are fully preserved.
 */
const sheet = new CSSStyleSheet();
sheet.replaceSync(rawCss);

export default sheet;

if (import.meta.hot) {
  import.meta.hot.accept(['./hmr-shared.css?raw'], ([mod]) => {
    if (mod) {
      sheet.replaceSync((mod as {default: string}).default);
    }
  });
}
