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
 *
 * Tradeoffs — inline shared sheet, the benchmark's all-round winner. ✅ One
 * parsed sheet shared by every adopter (fewest objects/nodes, fastest mount),
 * no runtime fetch so **no FOUC**, and in-place HMR with no component
 * re-render. ❌ Bytes ship in a JS chunk (not an independently cacheable
 * asset), and `?raw` skips the CSS pipeline. When the bytes should stay a
 * cacheable `.css` asset (e.g. a large generated utility sheet), use
 * `?css-sheet` instead and accept a brief FOUC — ../../docs/css-delivery.md
 * (benchmarked in bench/).
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
