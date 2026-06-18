/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import './hmr-counter.js';
import './hmr-lifecycle.js';
import './hmr-siblings.js';
import './hmr-parent.js';
import './hmr-styled.js';
import './hmr-probe.js';
import './hmr-properties.js';
import './hmr-signals.js';
import './hmr-clock.js';
import './hmr-digital-clock.js';
import './hmr-context.js';
import './hmr-task.js';
import './hmr-virtualizer.js';
import './hmr-linked-css.js';
import './hmr-import-css.js';
import './hmr-css-url.js';
import './hmr-raw-css.js';
import './hmr-shared-css-a.js';
import './hmr-shared-css-b.js';
import './hmr-utility-btn.js';
import './hmr-utility-badge.js';
import './hmr-vsheet-a.js';
import './hmr-vsheet-b.js';
import './hmr-modal.js';

export interface HmrProbeState {
  updates: number;
  /** Pinned DOM nodes for identity assertions across HMR updates. */
  keep: Map<string, unknown>;
}

declare global {
  interface Window {
    __hmr: HmrProbeState;
  }
}

window.__hmr = {updates: 0, keep: new Map()};

if (import.meta.hot) {
  import.meta.hot.on('vite:afterUpdate', () => {
    window.__hmr.updates++;
  });
}
