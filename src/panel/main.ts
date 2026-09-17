/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Entry module of the panel SPA. `index.html` loads this; Vite bundles it into
 * `dist/client`, which the devframe host serves as the dock's iframe.
 *
 * Importing the root element is enough — it registers `<lit-devtools-panel>`,
 * which the HTML already contains, and pulls in the views it renders.
 */

import './lit-devtools-panel.js';
