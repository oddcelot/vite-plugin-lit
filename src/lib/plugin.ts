/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {resolve as resolvePath} from 'node:path';
import {loadEnv, type CSSOptions, type Plugin} from 'vite';
import MagicString from 'magic-string';
import {injectSourceMeta} from './source-meta.js';
import {INSTALL_ID, VIRTUAL_PREFIX, transformLitModule} from './transform.js';
import {WRAP_TABLE} from './wrap-table.js';
import {createLitDevframePlugin} from './devframe/vite.js';
import {PACKAGE_VERSION} from './devframe/paths.js';
import {
  ENV_PREFIX,
  type LitPluginOptions,
  type ResolvedOptions,
  resolveOptions,
  toFeatureSettings,
} from './options.js';
import {
  OPEN_IN_EDITOR_PATH,
  createOpenInEditorMiddleware,
} from './plugins/open-in-editor.js';
import {litCssQueries} from './plugins/css-queries.js';
import {litTimelineVirtual} from './plugins/timeline-virtual.js';
import {resolveRuntimeModule, JS_FILE_RE} from './plugins/shared.js';

export {createOpenInEditorMiddleware} from './plugins/open-in-editor.js';
export {litCssQueries} from './plugins/css-queries.js';
export {litTimelineVirtual} from './plugins/timeline-virtual.js';
export type {
  HmrIndicatorOptions,
  HmrOptions,
  CssSheetBuild,
  LitPluginOptions,
  ResolvedOptions,
} from './options.js';
export {resolveOptions} from './options.js';

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
  // `lit-plugin-options` `config` hook below re-resolves with the loaded env
  // once Vite hands us the mode; this initial pass covers code paths that run
  // before (or without) it.
  let resolved: ResolvedOptions = resolveOptions(options, {});
  let root = '';
  // Env resolution lives in its own always-applied plugin: `?css-sheet` is a
  // build-time feature too, and the HMR plugin (`apply: 'serve'`) never gets a
  // `config` hook under `vite build`. `enforce: 'pre'` and first position put
  // it ahead of every other hook that reads `resolved`.
  const optionsPlugin: Plugin = {
    name: 'lit-plugin-options',
    enforce: 'pre',
    config(viteConfig, {mode}) {
      // `loadEnv` reads `.env*` files from the env dir (root by default) and
      // merges in matching `process.env` keys, filtered to the `LIT_PLUGIN`
      // prefix. Explicit options still win (handled in resolveOptions).
      const envDir = viteConfig.envDir
        ? resolvePath(viteConfig.envDir)
        : viteConfig.root
          ? resolvePath(viteConfig.root)
          : process.cwd();
      resolved = resolveOptions(options, loadEnv(mode, envDir, ENV_PREFIX));
    },
  };
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
      if (id === '@oddsquad/vite-plugin-lit/source-overlay.js') {
        return resolveRuntimeModule('source-overlay');
      }
      return null;
    },
    configureServer(server) {
      if (!resolved.sourceOverlay) return;
      // Allow opens from everything vite itself is willing to serve
      // (`server.fs.allow` defaults to the workspace root), not just
      // `config.root` — in monorepos, component sources regularly live in
      // sibling packages outside the served app's root.
      const fsAllow = server.config.server.fs?.allow ?? [];
      server.middlewares.use(
        OPEN_IN_EDITOR_PATH,
        createOpenInEditorMiddleware([root, ...fsAllow])
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
    config: () => {
      // Options are already resolved against the loaded env by
      // `lit-plugin-options`, which runs first.
      if (!resolved.hmrEnabled) {
        return;
      }
      // The injected runtime imports are invisible to the dep scanner. The
      // lit family stays prebundle-eligible on purpose: the wrapper modules'
      // bare imports then resolve to the same URL every other importer gets —
      // single lit instance, single template cache.
      return {optimizeDeps: {exclude: ['@oddsquad/vite-plugin-lit']}};
    },
    resolveId(id) {
      // Resolve the browser CSS helpers and indicator runtime to the copy
      // shipped next to this plugin, so they work even when the package
      // isn't reachable through node resolution from the served root (and
      // stay out of prebundling).
      //
      // These bare specifiers must match the package name in package.json —
      // consumers import them by name (see README "Stylesheets"), and Vite
      // only consults this hook for the exact string. A rename that misses
      // them turns the fallback into silently dead code.
      if (id === '@oddsquad/vite-plugin-lit/css.js') {
        return resolveRuntimeModule('css');
      }
      if (id === '@oddsquad/vite-plugin-lit/indicator.js') {
        return resolveRuntimeModule('indicator');
      }
      if (id === '@oddsquad/vite-plugin-lit/source-overlay.js') {
        return resolveRuntimeModule('source-overlay');
      }
      if (resolved.hmrEnabled && id.startsWith(VIRTUAL_PREFIX)) {
        return id;
      }
      return null;
    },
    load(id) {
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
    optionsPlugin,
    // Getter, not a snapshot: `resolved` is re-resolved against the loaded env
    // in `optionsPlugin`'s `config` hook, which runs after this array is built.
    litCssQueries(() => resolved.cssSheetBuild),
    litTimelineVirtual(() => resolved.timeline),
    litCssLiterals(),
    sourceOverlayPlugin,
    hmr,
  ];
  if (resolved.timeline) {
    // `features` is a getter, not a snapshot: `resolved` is re-resolved
    // against the loaded env in `optionsPlugin`'s `config` hook, which runs
    // after this array is built.
    plugins.push(
      createLitDevframePlugin({
        version: PACKAGE_VERSION,
        features: () => toFeatureSettings(resolved),
      })
    );
  }
  return plugins;
};
