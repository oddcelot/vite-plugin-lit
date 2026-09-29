/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite-plus';

/**
 * Build config for the script `lit-devtools dev` serves to pages outside Vite
 * (`src/lib/runtime/standalone.ts`).
 *
 * A single classic IIFE with `devframe/client` bundled in: the page loads it
 * with a plain `<script src>`, possibly cross-origin, so it can neither be an
 * ES module (module scripts need CORS) nor lean on bare imports.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // A dev-time tool read by whoever debugs it, like the panel.
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('../../dist/standalone', import.meta.url)),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(
        new URL('../lib/runtime/standalone.ts', import.meta.url)
      ),
      formats: ['iife'],
      name: 'LitDevtoolsStandalone',
      fileName: () => 'lit-devtools.js',
    },
  },
});
