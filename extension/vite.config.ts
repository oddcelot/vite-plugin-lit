import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite-plus';
import type {Plugin, UserConfig} from 'vite-plus';

/**
 * Build config for the extension, written to `dist/extension/` to be loaded
 * unpacked in Chrome, or with `LIT_EXTENSION_BROWSER=firefox` to
 * `dist/extension-firefox/` for Firefox (`build:extension:firefox`, see
 * {@link firefoxManifest} for what differs). Three passes, picked by `--mode`
 * (see `build:extension` in the package's scripts):
 *
 * - the default one builds the extension pages (`devtools.html`,
 *   `panel.html`) and the service worker, an ES module (`"type": "module"` in
 *   the manifest) at the fixed name the manifest gives, copies `public/`
 *   (the icons) and writes the manifest (see {@link manifest}). It runs first
 *   and clears the out dir;
 * - `page` and `content` each build one content script. Content scripts are
 *   classic scripts that cannot import, so each is a single self-contained
 *   IIFE, which one build cannot produce for two entries.
 *
 * No `lib.name` on the IIFEs: the page script runs in the page's own world,
 * where a named bundle would leave a global behind.
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const firefox = process.env['LIT_EXTENSION_BROWSER'] === 'firefox';

const outDir = here(
  firefox ? '../dist/extension-firefox' : '../dist/extension'
);

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(here(path), 'utf8')) as Record<string, unknown>;

/**
 * Writes `manifest.json` from `extension/manifest.json`, with the package's
 * version added. The source has no `version` on purpose: the extension ships
 * with the package's number, and one place to bump keeps the two from
 * drifting. A Chrome version is one to four dot-separated integers, so a
 * prerelease suffix (`1.0.0-beta.1`) fails the build here rather than at the
 * store.
 */
/**
 * The Firefox flavour of the manifest:
 *
 * - no service worker: Firefox runs the background as an event page, from
 *   `background.scripts`, still as a module;
 * - a toolbar popup (`popup.html`), the one place Firefox lets the extension
 *   ask for a site's host permission, with `activeTab` so it can read the
 *   current tab's URL;
 * - `browser_specific_settings.gecko`: the add-on id AMO signs it under, the
 *   data-collection declaration AMO requires (none), and Firefox 140, the
 *   first that reads that declaration (and an ESR); MAIN-world
 *   `registerContentScripts` needs 128;
 * - no `minimum_chrome_version`, which Firefox would warn about.
 */
const firefoxManifest = (
  source: Record<string, unknown>
): Record<string, unknown> => {
  const {
    minimum_chrome_version: _chrome,
    background,
    permissions,
    ...rest
  } = source as {
    minimum_chrome_version?: string;
    background: {service_worker: string; type: string};
    permissions: string[];
    icons: Record<string, string>;
  };
  return {
    ...rest,
    background: {scripts: [background.service_worker], type: background.type},
    permissions: [...permissions, 'activeTab'],
    action: {
      default_title: 'Lit Inspector',
      default_popup: 'popup.html',
      default_icon: rest.icons,
    },
    browser_specific_settings: {
      gecko: {
        id: 'lit-inspector@oddcelot.github.io',
        strict_min_version: '140.0',
        data_collection_permissions: {required: ['none']},
      },
    },
  };
};

const manifest = (): Plugin => ({
  name: 'lit-extension-manifest',
  generateBundle() {
    const {version} = readJson('../package.json');
    if (
      typeof version !== 'string' ||
      !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version)
    ) {
      throw new Error(
        `package.json version ${String(version)} is not a valid Chrome extension version`
      );
    }
    this.emitFile({
      type: 'asset',
      fileName: 'manifest.json',
      source: `${JSON.stringify(
        {
          ...(firefox
            ? firefoxManifest(readJson('manifest.json'))
            : readJson('manifest.json')),
          version,
        },
        null,
        2
      )}\n`,
    });
  },
});

/**
 * Swaps `src/lib/snapshot.ts` for `src/snapshot-stub.ts`. Export snapshot
 * needs a disk the extension doesn't have (the panel hides the button), and
 * the real module drags in devframe's build adapter, whose remote-asset
 * fetching names unpkg and jsDelivr; the store's review reads the package
 * for remote code, so none of it should be in there.
 */
const noSnapshot = (): Plugin => {
  const real = here('../src/lib/snapshot.ts');
  const stub = here('src/snapshot-stub.ts');
  return {
    name: 'lit-extension-no-snapshot',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('snapshot.js') || importer === stub) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved?.id === real ? stub : null;
    },
  };
};

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
        plugins: [manifest(), noSnapshot()],
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
              ...(firefox ? {popup: here('popup.html')} : {}),
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
