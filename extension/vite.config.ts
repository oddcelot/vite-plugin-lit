import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite-plus';
import type {UserConfig} from 'vite-plus';

/**
 * Build config for the Chrome extension, written to `dist/extension/` to be
 * loaded unpacked. Three passes, picked by `--mode` (see `build:extension` in
 * the package's scripts):
 *
 * - the default one builds the extension pages (`devtools.html`,
 *   `panel.html`) and the service worker, an ES module (`"type": "module"` in
 *   the manifest) at the fixed name the manifest gives, and copies `public/`
 *   (the manifest, the icon). It runs first and clears the out dir;
 * - `page` and `content` each build one content script. Content scripts are
 *   classic scripts that cannot import, so each is a single self-contained
 *   IIFE, which one build cannot produce for two entries.
 *
 * No `lib.name` on the IIFEs: the page script runs in the page's own world,
 * where a named bundle would leave a global behind.
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const outDir = here('../dist/extension');

const contentScript = (name: 'page' | 'content'): UserConfig => ({
  root: here('.'),
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: here(`src/${name}.ts`),
      output: {format: 'iife', entryFileNames: `${name}.js`},
    },
  },
});

export default defineConfig(({mode}) =>
  mode === 'page' || mode === 'content'
    ? contentScript(mode)
    : {
        root: here('.'),
        base: './',
        build: {
          outDir,
          emptyOutDir: true,
          // A dev-time tool read by whoever debugs it, like the panel.
          minify: false,
          sourcemap: true,
          // Every Chrome that runs MV3 has modulepreload.
          modulePreload: {polyfill: false},
          rollupOptions: {
            input: {
              devtools: here('devtools.html'),
              panel: here('panel.html'),
              background: here('src/background.ts'),
            },
            output: {
              entryFileNames: (chunk) =>
                chunk.name === 'background'
                  ? 'background.js'
                  : 'assets/[name]-[hash].js',
            },
          },
        },
      }
);
