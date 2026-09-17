/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite-plus';

/**
 * Build config for the DevTools panel SPA. The output is what
 * `src/lib/devframe/definition.ts` declares as the devframe's `clientAssets`,
 * so the host serves it at the dock's mount base.
 *
 * `base: './'` is required: the panel is mounted under a path the host picks
 * (`/__lit/` inside Vite DevTools, `/` when served standalone), so every asset
 * URL has to be relative to `document.baseURI` rather than absolute.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../../dist/client', import.meta.url)),
    // The out dir sits outside this config's root, so Vite declines to clear
    // it unless told explicitly.
    emptyOutDir: true,
    // The panel is a dev-time tool read by whoever debugs it; keep it
    // legible and skip the minifier.
    minify: false,
    sourcemap: true,
  },
});
