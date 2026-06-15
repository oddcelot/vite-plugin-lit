/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync} from 'node:fs';
import {resolve as resolvePath} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnv, type CSSOptions, type Plugin} from 'vite';
import MagicString from 'magic-string';
import {injectSourceMeta} from './source-meta.js';
import {INSTALL_ID, VIRTUAL_PREFIX, transformLitModule} from './transform.js';
import type {SourceOverlayOptions} from './types.js';
import type {FeatureSettings} from '../types/timeline.js';
import {WRAP_TABLE} from './wrap-table.js';
import {litTimelinePlugin} from './timeline-plugin.js';

/**
 * On-page HMR feedback: a small pulsing indicator in the corner of the host
 * page that briefly animates on each HMR update, for at-a-glance feedback
 * without watching the console.
 */
export interface HmrIndicatorOptions {
  /** Inject the indicator element. Defaults to `true` (when HMR is enabled). */
  enabled?: boolean;

  /**
   * Show a cumulative update count next to the dot (idle opacity 0.5 instead
   * of fully transparent). Defaults to `false`.
   */
  count?: boolean;
}

/**
 * HMR for Lit component classes and its on-page feedback.
 */
export interface HmrOptions {
  /**
   * Enable in-place HMR for Lit component classes. When `false`, the plugin
   * skips all HMR transforms and runtime injection. Defaults to `true`.
   */
  enabled?: boolean;

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
   * The on-page update indicator. `true` enables it without a count; an
   * object configures it. Forced off when HMR itself is disabled. Defaults
   * to enabled (without a count).
   */
  indicator?: boolean | HmrIndicatorOptions;
}

/**
 * Options for the Lit Vite plugin.
 *
 * Every option also resolves from environment variables (and `.env` files)
 * with the `LIT_PLUGIN` prefix — e.g. `LIT_PLUGIN_HMR_INDICATOR=true`. Options
 * passed here take precedence over env vars, which take precedence over the
 * built-in defaults.
 */
export interface LitPluginOptions {
  /**
   * HMR for Lit components and its on-page feedback. `true`/`false` toggles
   * the whole feature (patching and indicator); an object configures it.
   * Defaults to enabled.
   */
  hmr?: boolean | HmrOptions;

  /**
   * Dev-only click-to-open-in-IDE inspector for Lit custom elements.
   * Toggle with Ctrl+Shift+S (configurable via `key`). Defaults to `false`.
   */
  sourceOverlay?: boolean | SourceOverlayOptions;

  /**
   * Vite DevTools Timeline panel — a Vue DevTools–style layered event stream
   * for Lit lifecycle, render, mouse, and keyboard events.
   *
   * Requires `@vitejs/devtools` in the Vite config and the `@vitejs/devtools`
   * Vite plugin (`DevTools()`) to be active. Defaults to `false` while
   * experimental.
   *
   * `true` enables all built-in layers with defaults.
   */
  timeline?: boolean;
}

/** Plugin options after merging explicit options, env vars, and defaults. */
interface ResolvedOptions {
  hmrEnabled: boolean;
  reconnect: boolean;
  onIncompatible: 'reload' | 'warn';
  indicator: false | {count: boolean};
  sourceOverlay: false | SourceOverlayOptions;
  timeline: boolean;
}

/** Env var prefix consumed at config time. */
const ENV_PREFIX = 'LIT_PLUGIN';

/** Parse a boolean-ish env string; `undefined` when unset/unrecognized. */
const envBool = (v: string | undefined): boolean | undefined =>
  v === 'true' || v === '1'
    ? true
    : v === 'false' || v === '0'
      ? false
      : undefined;

/** Parse a numeric env string; `undefined` when unset/non-numeric. */
const envNum = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

/**
 * Merge explicit options over env vars over defaults (in that precedence) into
 * the flat shape the plugin hooks consume.
 */
const resolveOptions = (
  options: LitPluginOptions,
  env: Record<string, string>
): ResolvedOptions => {
  const hmr = options.hmr;
  const hmrObj = typeof hmr === 'object' ? hmr : undefined;
  const hmrEnabled =
    (typeof hmr === 'boolean' ? hmr : hmrObj?.enabled) ??
    envBool(env[`${ENV_PREFIX}_HMR`]) ??
    true;
  const reconnect =
    hmrObj?.reconnect ?? envBool(env[`${ENV_PREFIX}_HMR_RECONNECT`]) ?? false;
  const onIncompatible =
    hmrObj?.onIncompatible ??
    (env[`${ENV_PREFIX}_HMR_ON_INCOMPATIBLE`] as 'reload' | 'warn') ??
    'reload';

  const ind = hmrObj?.indicator;
  const indObj = typeof ind === 'object' ? ind : undefined;
  const indEnabled =
    (typeof ind === 'boolean' ? ind : indObj?.enabled) ??
    envBool(env[`${ENV_PREFIX}_HMR_INDICATOR`]) ??
    true;
  const indCount =
    indObj?.count ?? envBool(env[`${ENV_PREFIX}_HMR_INDICATOR_COUNT`]) ?? false;
  // The indicator is meaningless without HMR, so it follows the master toggle.
  const indicator = hmrEnabled && indEnabled ? {count: indCount} : false;

  const so = options.sourceOverlay;
  const soExplicit =
    typeof so === 'boolean' ? so : so === undefined ? undefined : true;
  const soEnabled =
    soExplicit ?? envBool(env[`${ENV_PREFIX}_SOURCE_OVERLAY`]) ?? false;
  let sourceOverlay: false | SourceOverlayOptions = false;
  if (soEnabled) {
    const base: SourceOverlayOptions = typeof so === 'object' ? {...so} : {};
    base.key ??= env[`${ENV_PREFIX}_SOURCE_OVERLAY_KEY`] || undefined;
    base.editor ??= env[`${ENV_PREFIX}_SOURCE_OVERLAY_EDITOR`] || undefined;
    base.throttleMs ??= envNum(env[`${ENV_PREFIX}_SOURCE_OVERLAY_THROTTLE_MS`]);
    sourceOverlay = base;
  }

  const timeline =
    options.timeline ?? envBool(env[`${ENV_PREFIX}_TIMELINE`]) ?? false;

  return {
    hmrEnabled,
    reconnect,
    onIncompatible,
    indicator,
    sourceOverlay,
    timeline,
  };
};

/**
 * Flattens resolved options into the JSON-serializable shape the panel's
 * Settings tab consumes (callback options like `exclude`/`onSelect` dropped;
 * a custom editor object reported as `"custom"`). Default key/editor/throttle
 * are applied here so the panel shows the effective values the runtime uses.
 */
const toFeatureSettings = (r: ResolvedOptions): FeatureSettings => {
  const so = r.sourceOverlay;
  const editor = so === false ? undefined : so.editor;
  return {
    hmr: {
      enabled: r.hmrEnabled,
      reconnect: r.reconnect,
      onIncompatible: r.onIncompatible,
      indicatorEnabled: r.indicator !== false,
      indicatorCount: r.indicator !== false && r.indicator.count,
    },
    sourceOverlay: {
      enabled: so !== false,
      key: (so === false ? undefined : so.key) ?? 's',
      editor:
        typeof editor === 'string' ? editor : editor ? 'custom' : 'vscode',
      throttleMs: (so === false ? undefined : so.throttleMs) ?? 50,
    },
    timeline: r.timeline,
  };
};

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

/**
 * `import sheet from './x.css?css-sheet'` — a constructed, shareable
 * `CSSStyleSheet` backed by the `.css` asset that hot-swaps in place. Adopt it
 * from any number of components (`static styles = [sheet]`); a source edit
 * re-fetches and `replaceSync()`s it, updating every shadow root that adopted
 * it without re-rendering a component or reloading the page.
 *
 * This is the `urlSheet()` helper plus its irreducible HMR wiring, lifted into
 * a plugin-generated module: the `import.meta.hot.accept` lives here (where
 * Vite's static analysis sees the literal specifier), so callers write a bare
 * import and never touch `import.meta.hot` themselves.
 */
const CSS_SHEET_QUERY_RE = /^([^?]+\.css)\?(?:[^&]*&)*css-sheet(?:&.*)?$/;
const CSS_SHEET_VIRTUAL_PREFIX = '\0lit-plugin:css-sheet:';
// The virtual id must not end in `.css`, or Vite's CSS plugins (which match
// the id's extension regardless of `\0`) would compile the wrapper as CSS.
const CSS_VIRTUAL_SUFFIX = '.js';

/**
 * Import-query support, served in dev and build alike (source code using
 * `?hmr-url`/`?css-sheet` must keep working under `vite build`, where the HMR
 * plugin doesn't apply). Exported for the baseline e2e run, which needs the
 * queries working without the HMR plugin.
 */
export const litCssQueries = (): Plugin => ({
  name: 'lit-css-query',
  // Vite's core resolver claims `./x.css?hmr-url` for the CSS pipeline
  // before normal plugins get a look, so resolve ahead of it.
  enforce: 'pre',
  async resolveId(id, importer) {
    const prefix = CSS_URL_QUERY_RE.test(id)
      ? CSS_URL_VIRTUAL_PREFIX
      : CSS_SHEET_QUERY_RE.test(id)
        ? CSS_SHEET_VIRTUAL_PREFIX
        : null;
    if (prefix === null) {
      return null;
    }
    const file = id.slice(0, id.indexOf('?'));
    const resolved = await this.resolve(file, importer);
    if (resolved === null) {
      return null;
    }
    return prefix + resolved.id + CSS_VIRTUAL_SUFFIX;
  },
  load(id) {
    const helperPath = resolveRuntimeModule('css');
    if (id.startsWith(CSS_URL_VIRTUAL_PREFIX)) {
      const file = id.slice(
        CSS_URL_VIRTUAL_PREFIX.length,
        -CSS_VIRTUAL_SUFFIX.length
      );
      return {
        code:
          `import url from ${JSON.stringify(`${file}?url`)};\n` +
          `import {devCacheBust} from ${JSON.stringify(helperPath)};\n` +
          `export default devCacheBust(url);\n`,
        moduleType: 'js',
      };
    }
    if (id.startsWith(CSS_SHEET_VIRTUAL_PREFIX)) {
      const file = id.slice(
        CSS_SHEET_VIRTUAL_PREFIX.length,
        -CSS_VIRTUAL_SUFFIX.length
      );
      // The accept specifier must be byte-identical to the import above —
      // Vite resolves accepted HMR deps by static analysis. Generating both
      // here is exactly what frees the caller from writing it. The swap is
      // self-accepted at this boundary, so it never propagates to adopters.
      const urlSpecifier = JSON.stringify(`${file}?url`);
      return {
        code:
          `import url from ${urlSpecifier};\n` +
          `import {urlSheet} from ${JSON.stringify(helperPath)};\n` +
          `const {sheet, onHotUpdate} = urlSheet(url);\n` +
          `export default sheet;\n` +
          `if (import.meta.hot) {\n` +
          `  import.meta.hot.accept(${urlSpecifier}, onHotUpdate);\n` +
          `}\n`,
        moduleType: 'js',
      };
    }
    return null;
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
  // Resolved from explicit options first, env vars second, defaults last. The
  // `config` hook re-resolves with the loaded env once Vite hands us the mode;
  // this initial pass covers code paths that run before (or without) it.
  let resolved: ResolvedOptions = resolveOptions(options, {});
  let root = '';
  const sourceOverlayPlugin: Plugin = {
    name: 'lit-source-overlay',
    apply: 'serve',
    // Run before Vite's esbuild TS transform so source-meta line numbers are
    // measured against the author's raw source (and the `@customElement … class`
    // forms are still intact), not against transpiled output.
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      if (id === '@lit-labs/vite-plugin-lit/source-overlay.js') {
        return resolveRuntimeModule('source-overlay');
      }
      return null;
    },
    configureServer(server) {
      if (!resolved.sourceOverlay) return;
      server.middlewares.use(
        OPEN_IN_EDITOR_PATH,
        createOpenInEditorMiddleware()
      );
    },
    transform(code, id, transformOptions) {
      if (!resolved.sourceOverlay) return null;
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
      const relativeFile = file.startsWith(root + '/')
        ? file.slice(root.length + 1)
        : file;
      if (!injectSourceMeta(code, relativeFile, ms)) {
        return null;
      }
      return {code: ms.toString(), map: ms.generateMap({hires: true})};
    },
    transformIndexHtml() {
      if (!resolved.sourceOverlay) return;
      const overlayUrl = `/@fs/${resolveRuntimeModule('source-overlay')}`;
      const {
        exclude: _exclude,
        onSelect: _onSelect,
        ...overlayInit
      } = resolved.sourceOverlay;
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
    config: (viteConfig, {mode}) => {
      // Resolve options against the loaded env now that Vite hands us the mode.
      // `loadEnv` reads `.env*` files from the env dir (root by default) and
      // merges in matching `process.env` keys, filtered to the `LIT_PLUGIN`
      // prefix. Explicit options still win (handled in resolveOptions).
      const envDir = viteConfig.envDir
        ? resolvePath(viteConfig.envDir)
        : viteConfig.root
          ? resolvePath(viteConfig.root)
          : process.cwd();
      resolved = resolveOptions(options, loadEnv(mode, envDir, ENV_PREFIX));
      if (!resolved.hmrEnabled) {
        return;
      }
      // The injected runtime imports are invisible to the dep scanner. The
      // lit family stays prebundle-eligible on purpose: the wrapper modules'
      // bare imports then resolve to the same URL every other importer gets —
      // single lit instance, single template cache.
      return {optimizeDeps: {exclude: ['@lit-labs/vite-plugin-lit']}};
    },
    resolveId(id) {
      // Public timeline API virtual module.
      if (id === 'virtual:lit-plugin/timeline') {
        return '\0virtual:lit-plugin/timeline';
      }
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
      if (resolved.hmrEnabled && id.startsWith(VIRTUAL_PREFIX)) {
        return id;
      }
      return null;
    },
    load(id) {
      // Public timeline API — re-export the runtime module when timeline is
      // enabled, otherwise a no-op stub so imports don't throw in prod builds.
      if (id === '\0virtual:lit-plugin/timeline') {
        if (!resolved.timeline) {
          return {
            code:
              'export const addTimelineEvent = () => {};\n' +
              'export const addTimelineLayer = () => {};\n',
            moduleType: 'js',
          };
        }
        const apiPath = resolveRuntimeModule('timeline/public-api');
        return {
          code: `export * from ${JSON.stringify(apiPath)};\n`,
          moduleType: 'js',
        };
      }
      if (!resolved.hmrEnabled || !id.startsWith(VIRTUAL_PREFIX)) {
        return null;
      }
      if (id === INSTALL_ID) {
        const patchPath = resolveRuntimeModule('patch');
        const runtimeOptions = {
          reconnect: resolved.reconnect,
          onIncompatible: resolved.onIncompatible,
        };
        return {
          code:
            `import {install} from ${JSON.stringify(patchPath)};\n` +
            `install(${JSON.stringify(runtimeOptions)});\n`,
          moduleType: 'js',
        };
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
      return {code: lines.join('\n') + '\n', moduleType: 'js'};
    },
    async transform(code, id, transformOptions) {
      if (!resolved.hmrEnabled) {
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
      const tags: {
        tag: string;
        attrs?: Record<string, string | undefined | boolean>;
        children?: string;
        injectTo: 'body';
      }[] = [];

      const indicator = resolved.indicator;
      if (indicator) {
        const indicatorUrl = `/@fs/` + resolveRuntimeModule('indicator');
        tags.push(
          {
            tag: 'script',
            attrs: {type: 'module', src: indicatorUrl},
            injectTo: 'body',
          },
          {
            tag: 'lit-devtools-hmr-indicator',
            attrs: indicator.count ? {count: ''} : undefined,
            children: '',
            injectTo: 'body',
          }
        );
      }

      if (resolved.timeline) {
        const installUrl = `/@fs/` + resolveRuntimeModule('timeline/install');
        tags.push({
          tag: 'script',
          attrs: {type: 'module', src: installUrl},
          injectTo: 'body',
        });
        // Components inspector runtime — answers the panel's tree/details
        // requests. Paired with the timeline panel, which hosts its tab.
        const inspectorUrl =
          `/@fs/` + resolveRuntimeModule('inspector/install');
        tags.push({
          tag: 'script',
          attrs: {type: 'module', src: inspectorUrl},
          injectTo: 'body',
        });
      }

      return tags.length > 0 ? tags : undefined;
    },
  };
  // The source-overlay plugin is always present; its hooks no-op when the
  // feature is disabled (which env may decide), so inclusion can't be gated
  // on the synchronously-known options here.
  const plugins: Plugin[] = [
    litCssQueries(),
    litCssLiterals(),
    sourceOverlayPlugin,
    hmr,
  ];
  if (resolved.timeline) {
    // Pass a getter, not a snapshot: `resolved` is re-resolved against the
    // loaded env in the `config` hook, which runs after this plugin array is
    // built. The settings endpoint reads it per-request, by which point env is
    // applied.
    plugins.push(litTimelinePlugin(() => toFeatureSettings(resolved)));
  }
  return plugins;
};
