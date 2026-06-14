/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {DevTools} from '@vitejs/devtools';
import Inspect from 'vite-plugin-inspect';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(async ({mode}) => {
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
  // The plugin reads its own `LIT_PLUGIN_*` options from the env at config
  // time (see .env.example); here we only need the playground server port.
  const env = loadEnv(mode, process.cwd(), 'LIT_PLUGIN');
  const port = env.LIT_PLUGIN_PLAYGROUND_PORT
    ? Number(env.LIT_PLUGIN_PLAYGROUND_PORT)
    : 5179;
  return {
    server: {
      port,
      strictPort: true,
    },
    // Root `devtools` config sets up the DevTools server + auth. Paired with
    // the `DevTools()` plugin below (which injects the embedded overlay), this
    // is what makes the floating panel appear.
    //
    // `clientAuth: false` skips the per-browser permission prompt. DevTools
    // normally gates connections behind a terminal approval, which can't be
    // answered when this playground is opened on StackBlitz/bolt.new. Safe
    // here because it's a throwaway demo server; do NOT copy this into a real
    // project, especially with `server.host` exposed to LAN/WAN.
    devtools: {
      enabled: true,
      clientAuth: false,
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
      // CSS minification would strip the color fallbacks the transform just
      // generated — skip it, these are demo stylesheets meant to be read.
      cssMinify: false,
      // Skip minification — these are demo assets meant to be read.
      minify: false,
      // Split each HMR component into its own chunk for better visibility.
      rolldownOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('/src/hmr-') && id.endsWith('.ts')) {
              const match = id.match(/\/src\/(hmr-[\w-]+)\.ts$/);
              if (match) return match[1];
            }
          },
        },
      },
    },
    // `DevTools()` injects the embedded overlay client. It returns a
    // Promise<Plugin[]>, which Vite awaits and flattens.
    plugins: [litPlugin(), Inspect(), DevTools()],
  };
});
