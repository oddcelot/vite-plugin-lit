/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {defineConfig} from 'vite';

export default defineConfig(async () => {
  // Inside the monorepo, use the built package output (`npm run dev` via
  // wireit builds it first). When the playground is opened standalone —
  // e.g. imported into StackBlitz/bolt.new from the repo URL — the parent
  // package isn't there, so fall back to the published plugin.
  // The indirection keeps the config bundler from trying (and warning
  // about failing) to resolve the fallback inside the monorepo.
  const fallback = '@oddsquad/vite-plugin-lit';
  const {litPlugin} = await import('../index.js').catch(
    () => import(/* @vite-ignore */ fallback)
  );
  return {
    server: {
      port: 5179,
      strictPort: true,
    },
    css: {
      // Process all CSS with Lightning CSS instead of PostCSS — applies to
      // dev-served .css files and built assets alike. The conservative
      // targets force visible downleveling (nesting flattened, oklch()
      // resolved to fallbacks) in the demo stylesheets. Note that `?raw`
      // imports bypass the CSS pipeline and stay unprocessed.
      transformer: 'lightningcss' as const,
      lightningcss: {
        // major << 16 | minor << 8 (Lightning CSS version encoding).
        targets: {chrome: 100 << 16, safari: 15 << 16},
      },
    },
    build: {
      // The cssMinify pass strips the color fallbacks the transform just
      // generated: under Vite 8 (monorepo) Lightning CSS minifies without
      // receiving css.lightningcss.targets, and under Vite 7 (standalone)
      // the esbuild default merges duplicate declarations. Skip
      // minification — these are demo stylesheets meant to be read anyway.
      cssMinify: false,
      // Skip minification — these are demo assets meant to be read.
      minify: false,
      // Split each HMR component into its own chunk for better visibility
      // and debugging of the HMR output.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/src/hmr-') && id.endsWith('.ts')) {
              const match = id.match(/\/src\/(hmr-[\w-]+)\.ts$/);
              if (match) return match[1];
            }
          },
        },
      },
    },
    plugins: [litPlugin({updateIndicator: {count: true}, sourceOverlay: true})],
  };
});
