import {resolve as resolvePath} from 'node:path';
import {loadEnv, type Plugin} from 'vite';
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
import {litCssLiterals} from './plugins/css-literals.js';
import {litPrivateFields} from './plugins/private-fields.js';
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
          childState: resolved.childState,
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
    litPrivateFields(() => resolved.hmrEnabled && resolved.privateFields),
    sourceOverlayPlugin,
    hmr,
  ];
  // Only an explicit `timeline: false` is final this early: env may still
  // turn the timeline on in `optionsPlugin`'s `config` hook, so otherwise the
  // devframe plugin is included and skips mounting when it stays off.
  if (options.timeline !== false) {
    // `enabled` and `features` are getters, not snapshots, for the same
    // reason.
    plugins.push(
      createLitDevframePlugin({
        version: PACKAGE_VERSION,
        enabled: () => resolved.timeline,
        features: () => toFeatureSettings(resolved),
        // Only a named editor counts: `toFeatureSettings` reports `vscode`
        // for "never chose", which must not turn into a forced `code`.
        configuredEditor: () => {
          const so = resolved.sourceOverlay;
          return so !== false && typeof so.editor === 'string'
            ? so.editor
            : undefined;
        },
      })
    );
  }
  return plugins;
};
