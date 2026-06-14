/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Ambient types for the import queries provided by the Lit Vite plugin.
 *
 * Reference via tsconfig (`"types": ["@lit-labs/vite-plugin-lit/client"]`) or
 * `/// <reference types="@lit-labs/vite-plugin-lit/client" />`.
 */

declare module '*.css?hmr-url' {
  const href: string;
  export default href;
}

declare module '*.css?css-sheet' {
  const sheet: CSSStyleSheet;
  export default sheet;
}
