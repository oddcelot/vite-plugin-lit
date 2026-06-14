/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Entry point for the source overlay runtime. The plugin resolves this module
// by path and imports initSourceOverlay; the implementation lives in
// ./source-overlay/. Importing the element module also registers the
// <lit-source-overlay> custom element as a side effect.
export {
  initSourceOverlay,
  toggleSourceOverlay,
  type SourceOverlayInitOptions,
} from './source-overlay/overlay-element.js';
