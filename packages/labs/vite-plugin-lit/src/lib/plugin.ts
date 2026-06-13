/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {CSSOptions, Plugin} from 'vite';
import MagicString from 'magic-string';
import {injectSourceMeta} from './source-meta.js';
import {INSTALL_ID, VIRTUAL_PREFIX, transformLitModule} from './transform.js';
import type {SourceOverlayOptions} from './types.js';
import {WRAP_TABLE} from './wrap-table.js';

/**
 * Options for the Lit Vite plugin.
 */
export interface LitPluginOptions {
  /**
   * Enable in-place HMR for Lit component classes. When `false`, the
   * plugin skips all HMR transforms and runtime injection — useful when
   * you want the `updateIndicator` feedback without the hot-patching.
   * Defaults to `true`.
   */
  hmr?: boolean;

  /**
   * Cycle `disconnectedCallback()`/`connectedCallback()` on live instances
   * after a hot patch. Interning makes this mostly unnecessary, so it's
   * opt-in. Defaults to `false`.
   */
  reconnect?: boolean;

  /**
   * What to do when a component can't be hot-patched in place (e.g.
   * standard `accessor` decorators). Defaults to `'reload'`.
   */
  onIncompatible?: 'reload' | 'warn';

  /**
   * Inject a small pulsing indicator in the bottom-right corner of the host
   * page that briefly animates on each HMR update. Provides at-a-glance
   * visual feedback without looking at the console.
   *
   * - `true` — simple dot (idle opacity 0, no count).
   * - `{ count: true }` — pill with count (idle opacity 0.5).
   * - `{ count: false }` — pill without count (idle opacity 0).
   * - `false` or omitted — disabled. Defaults to `false`.
   */
  updateIndicator?: boolean | {count?: boolean};

  /**
   * Dev-only click-to-open-in-IDE inspector for Lit custom elements.
   * Toggle with Ctrl+Shift+S (configurable via `key`). Defaults to `false`.
   */
  sourceOverlay?: boolean | SourceOverlayOptions;
}

/**
 * Resolves a runtime module to an absolute fs path (served via `/@fs/`), so
 * the plugin works from any served root. Falls back from the built `.js` to
 * the `.ts` source when running un-built (e.g. under vitest).
 */
const resolveRuntimeModule = (name: string): string => {
  for (const ext of ['js', 'ts'] as const) {
    const url = new URL(`./runtime/${name}.${ext}`, import.meta.url);
    if (existsSync(url)) {
      return fileURLToPath(url).replace(/\\/g, '/');
    }
  }
  throw new Error(`[lit-plugin] runtime module not found: ${name}`);
};

const JS_FILE_RE = /\.[cm]?[jt]sx?$/;

const OPEN_IN_EDITOR_PATH = '/__lit-open-in-editor';

const normalizeSourceOverlayOptions = (
  option: boolean | SourceOverlayOptions | undefined
): false | SourceOverlayOptions => {
  if (!option) return false;
  if (typeof option === 'boolean') return {};
  return option;
};

const createOpenInEditorMiddleware = () => {
  return (
    req: {url?: string},
    res: {statusCode: number; end: (msg: string) => void},
    next: (err?: unknown) => void
  ) => {
    if (req.url === undefined) {
      next();
      return;
    }
    const query = req.url.includes('?')
      ? req.url.slice(req.url.indexOf('?') + 1)
      : '';
    const params = new URLSearchParams(query);
    const file = params.get('file');
    if (file === null) {
      res.statusCode = 400;
      res.end('missing file parameter');
      return;
    }
    const line = params.get('line') ?? '1';
    const column = params.get('column') ?? '1';
    const fileRef = `${file}:${line}:${column}`;
    import('launch-editor')
      .then(
        (mod: {
          default?: (
            file: string,
            cb: (fileName: string, errorMessage: string | null) => void
          ) => void;
        }) => {
          const launch = (mod.default ?? mod) as (
            file: string,
            cb: (fileName: string, errorMessage: string | null) => void
          ) => void;
          launch(fileRef, (_fileName: string, errorMessage: string | null) => {
            if (errorMessage !== null) {
              res.statusCode = 500;
              res.end(errorMessage);
              return;
            }
            res.end('ok');
          });
        }
      )
      .catch(next);
  };
};

/**
 * `import href from './x.css?hmr-url'` — `?url` semantics with working HMR.
 * The string is a real stylesheet URL (dev-served CSS file; hashed `.css`
 * asset on build) for shadow-root `<link>` hrefs and `@import url()`s. In
 * dev, each HMR re-execution yields a freshly cache-busted href, so the
 * browser refetches the changed stylesheet; in build the `?url` asset URL
 * passes through unchanged.
 */
const CSS_URL_QUERY_RE = /^([^?]+\.css)\?(?:[^&]*&)*hmr-url(?:&.*)?$/;
const CSS_URL_VIRTUAL_PREFIX = '\0lit-plugin:hmr-url:';
// The virtual id must not end in `.css`, or Vite's CSS plugins (which match
// the id's extension regardless of `\0`) would compile the wrapper as CSS.
const CSS_URL_VIRTUAL_SUFFIX = '.js';

/**
 * Import-query support, served in dev and build alike (source code using
 * `?hmr-url` must keep working under `vite build`, where the HMR plugin
 * doesn't apply). Exported for the baseline e2e run, which needs the query
 * working without the HMR plugin.
 */
export const litCssQueries = (): Plugin => ({
  name: 'lit-css-query',
  // Vite's core resolver claims `./x.css?hmr-url` for the CSS pipeline
  // before normal plugins get a look, so resolve ahead of it.
  enforce: 'pre',
  async resolveId(id, importer) {
    const match = CSS_URL_QUERY_RE.exec(id);
    if (match === null) {
      return null;
    }
    const resolved = await this.resolve(match[1], importer);
    if (resolved === null) {
      return null;
    }
    return CSS_URL_VIRTUAL_PREFIX + resolved.id + CSS_URL_VIRTUAL_SUFFIX;
  },
  load(id) {
    if (!id.startsWith(CSS_URL_VIRTUAL_PREFIX)) {
      return null;
    }
    const file = id.slice(
      CSS_URL_VIRTUAL_PREFIX.length,
      -CSS_URL_VIRTUAL_SUFFIX.length
    );
    const helperPath = resolveRuntimeModule('css');
    return (
      `import url from ${JSON.stringify(`${file}?url`)};\n` +
      `import {devCacheBust} from ${JSON.stringify(helperPath)};\n` +
      `export default devCacheBust(url);\n`
    );
  },
});

/**
 * A `css` tagged template literal with no interpolations and no escape
 * sequences — the only kind we can hand to a CSS parser as-is. Literals
 * with `${…}` holes or backslashes simply don't match and stay untouched.
 * The lookbehind keeps `unsafeCSS`/`myCss`-style tags from matching.
 */
const CSS_LITERAL_RE = /(?<![\w$.])css`((?:[^`\\$]|\$(?!\{))*)`/g;

/**
 * Runs Vite's configured Lightning CSS over `css` tagged template literals
 * in user modules, which the CSS pipeline itself never sees (they're plain
 * JS strings to it). Inert unless `css.transformer` is `'lightningcss'`;
 * options come from `css.lightningcss`, so component styles get the same
 * treatment (targets, drafts, …) as `.css` files. Applies in dev and build.
 */
const litCssLiterals = (): Plugin => {
  let lightningcss: typeof import('lightningcss') | null = null;
  let options: CSSOptions['lightningcss'];
  let minify = false;
  return {
    name: 'lit-css-literals',
    async configResolved(config) {
      if (config.css.transformer !== 'lightningcss') {
        return;
      }
      // The transformer setting guarantees the dependency: Vite itself
      // can't process .css files without it.
      lightningcss = await import('lightningcss');
      // cssModules makes no sense for a literal; everything else carries
      // over.
      const {cssModules: _cssModules, ...rest} = config.css.lightningcss ?? {};
      options = rest;
      minify = config.command === 'build';
    },
    transform(code, id) {
      if (lightningcss === null) {
        return null;
      }
      if (id.startsWith('\0') || id.includes('/node_modules/')) {
        return null;
      }
      const [file] = id.split('?', 2);
      if (!JS_FILE_RE.test(file) || !code.includes('css`')) {
        return null;
      }
      const ms = new MagicString(code);
      let changed = false;
      for (const m of code.matchAll(CSS_LITERAL_RE)) {
        const literal = m[1];
        if (literal.trim() === '') {
          continue;
        }
        let out: string;
        try {
          const result = lightningcss.transform({
            ...options,
            filename: file,
            code: Buffer.from(literal),
            minify,
          });
          out = Buffer.from(result.code).toString();
        } catch (e) {
          this.warn(
            `[lit-plugin] skipping css literal Lightning CSS couldn't parse: ${
              (e as Error).message
            }`
          );
          continue;
        }
        // Re-escape for the template literal the output goes back into.
        out = out.replace(/[\\`$]/g, '\\$&');
        if (out !== literal) {
          const start = m.index + 'css`'.length;
          ms.overwrite(start, start + literal.length, out);
          changed = true;
        }
      }
      if (!changed) {
        return null;
      }
      return {code: ms.toString(), map: ms.generateMap({hires: true})};
    },
  };
};

/**
 * Vite plugin set providing HMR, CSS helpers, and Lightning CSS processing
 * for Lit projects.
 */
export const litPlugin = (options: LitPluginOptions = {}): Plugin[] => {
  const enableHmr = options.hmr ?? true;
  const sourceOverlayOptions = normalizeSourceOverlayOptions(
    options.sourceOverlay
  );
  const runtimeOptions = {
    reconnect: options.reconnect ?? false,
    onIncompatible: options.onIncompatible ?? 'reload',
  };
  const sourceOverlayPlugin: Plugin = {
    name: 'lit-source-overlay',
    apply: 'serve',
    // Run before Vite's esbuild TS transform so source-meta line numbers are
    // measured against the author's raw source (and the `@customElement … class`
    // forms are still intact), not against transpiled output.
    enforce: 'pre',
    resolveId(id) {
      if (id === '@lit-labs/vite-plugin-lit/source-overlay.js') {
        return resolveRuntimeModule('source-overlay');
      }
      return null;
    },
    configureServer(server) {
      if (!sourceOverlayOptions) return;
      server.middlewares.use(
        OPEN_IN_EDITOR_PATH,
        createOpenInEditorMiddleware()
      );
    },
    transform(code, id, transformOptions) {
      if (!sourceOverlayOptions) return null;
      if (transformOptions?.ssr) return null;
      if (
        id.startsWith('\0') ||
        id.includes('__x00__') ||
        id.includes('lit-plugin:') ||
        id.includes('/node_modules/')
      ) {
        return null;
      }
      const [file] = id.split('?', 2);
      if (!JS_FILE_RE.test(file) && !id.includes('?html-proxy')) {
        return null;
      }
      if (!code.includes('customElement') && !code.includes('customElements')) {
        return null;
      }
      const ms = new MagicString(code);
      if (!injectSourceMeta(code, file, ms)) {
        return null;
      }
      return {code: ms.toString(), map: ms.generateMap({hires: true})};
    },
    transformIndexHtml() {
      if (!sourceOverlayOptions) return;
      const overlayUrl = `/@fs/${resolveRuntimeModule('source-overlay')}`;
      const {
        exclude: _exclude,
        onSelect: _onSelect,
        ...overlayInit
      } = sourceOverlayOptions;
      const initConfig = {
        ...overlayInit,
        openInEditorPath: OPEN_IN_EDITOR_PATH,
      };
      return [
        {
          tag: 'script',
          attrs: {type: 'module'},
          children: `import {initSourceOverlay} from ${JSON.stringify(overlayUrl)};\ninitSourceOverlay(${JSON.stringify(initConfig)});\n`,
          injectTo: 'body',
        },
      ];
    },
  };
  const hmr: Plugin = {
    name: 'lit-plugin',
    apply: 'serve',
    config: () => {
      if (!enableHmr) {
        return;
      }
      // The injected runtime imports are invisible to the dep scanner. The
      // lit family stays prebundle-eligible on purpose: the wrapper modules'
      // bare imports then resolve to the same URL every other importer gets —
      // single lit instance, single template cache.
      return {optimizeDeps: {exclude: ['@lit-labs/vite-plugin-lit']}};
    },
    resolveId(id) {
      // Resolve the browser CSS helpers and indicator runtime to the copy
      // shipped next to this plugin, so they work even when the package
      // isn't reachable through node resolution from the served root (and
      // stay out of prebundling).
      if (id === '@lit-labs/vite-plugin-lit/css.js') {
        return resolveRuntimeModule('css');
      }
      if (id === '@lit-labs/vite-plugin-lit/indicator.js') {
        return resolveRuntimeModule('indicator');
      }
      if (id === '@lit-labs/vite-plugin-lit/source-overlay.js') {
        return resolveRuntimeModule('source-overlay');
      }
      if (enableHmr && id.startsWith(VIRTUAL_PREFIX)) {
        return id;
      }
      return null;
    },
    load(id) {
      if (!enableHmr || !id.startsWith(VIRTUAL_PREFIX)) {
        return null;
      }
      if (id === INSTALL_ID) {
        const patchPath = resolveRuntimeModule('patch');
        return (
          `import {install} from ${JSON.stringify(patchPath)};\n` +
          `install(${JSON.stringify(runtimeOptions)});\n`
        );
      }
      const spec = id.slice(VIRTUAL_PREFIX.length);
      const wrappedTags = WRAP_TABLE.get(spec);
      if (wrappedTags === undefined) {
        return null;
      }
      const internPath = resolveRuntimeModule('intern');
      // Browser-native ESM: explicit local exports shadow `export *` names
      // (spec-guaranteed), so everything except the wrapped tags passes
      // through unchanged.
      const lines = [
        `import * as __lit from ${JSON.stringify(spec)};`,
        `import {wrapTag} from ${JSON.stringify(internPath)};`,
        `export * from ${JSON.stringify(spec)};`,
      ];
      for (const {exportName, ns} of wrappedTags) {
        lines.push(
          `export const ${exportName} = wrapTag(__lit.${exportName}, ${JSON.stringify(
            ns
          )});`
        );
      }
      return lines.join('\n') + '\n';
    },
    async transform(code, id, transformOptions) {
      if (!enableHmr) {
        return null;
      }
      if (transformOptions?.ssr) {
        return null;
      }
      if (id.startsWith('\0') || id.includes('/node_modules/')) {
        return null;
      }
      const [file] = id.split('?', 2);
      // Allow inline scripts extracted from HTML (`?html-proxy`).
      if (!JS_FILE_RE.test(file) && !id.includes('?html-proxy')) {
        return null;
      }
      return transformLitModule(code);
    },
    transformIndexHtml() {
      if (!options.updateIndicator) {
        return;
      }
      const isSimple = typeof options.updateIndicator === 'boolean';
      const withCount =
        !isSimple &&
        (options.updateIndicator as {count?: boolean}).count !== false;
      const indicatorUrl = `/@fs/` + resolveRuntimeModule('indicator');
      return [
        {
          tag: 'script',
          attrs: {type: 'module', src: indicatorUrl},
          injectTo: 'body',
        },
        {
          tag: 'lit-devtools-indicator',
          attrs: withCount ? {count: ''} : undefined,
          children: '',
          injectTo: 'body',
        },
      ];
    },
  };
  const plugins = [litCssQueries(), litCssLiterals()];
  if (sourceOverlayOptions) {
    plugins.push(sourceOverlayPlugin);
  }
  plugins.push(hmr);
  return plugins;
};
