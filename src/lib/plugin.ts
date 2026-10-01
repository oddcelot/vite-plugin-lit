import type {Plugin} from 'vite';
import MagicString from 'magic-string';
import {injectSourceMeta} from './source-meta.js';
import {INSTALL_ID, VIRTUAL_PREFIX, transformLitModule} from './transform.js';
import {WRAP_TABLE} from './wrap-table.js';
import {createLitDevframePlugin} from './devframe/vite.js';
import {PACKAGE_VERSION} from './devframe/paths.js';
import {type LitPluginOptions, toFeatureSettings} from './options.js';
import {createOptionsContext} from './plugins/context.js';
import {
  OPEN_IN_EDITOR_PATH,
  createOpenInEditorMiddleware,
} from './plugins/open-in-editor.js';
import {litCssQueries} from './plugins/css-queries.js';
import {litTimelineVirtual} from './plugins/timeline-virtual.js';
import {litCssLiterals} from './plugins/css-literals.js';
import {litPrivateFields} from './plugins/private-fields.js';
import {resolveRuntimeModule} from './plugins/shared.js';

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
  // Explicit options first, env vars second, defaults last. The context
  // resolves against the loaded env in its `config` hook; every hook below
  // reads `ctx.get()` at call time.
  const ctx = createOptionsContext(options);
  const sourceOverlayPlugin: Plugin = {
    name: 'lit-source-overlay',
    apply: 'serve',
    // Run before Vite's esbuild TS transform so source-meta line numbers are
    // measured against the author's raw source (and the `@customElement … class`
    // forms are still intact), not against transpiled output.
    enforce: 'pre',
    configureServer(server) {
      if (!ctx.get().sourceOverlay) return;
      // Allow opens from everything vite itself is willing to serve
      // (`server.fs.allow` defaults to the workspace root), not just
      // `config.root` — in monorepos, component sources regularly live in
      // sibling packages outside the served app's root.
      const fsAllow = server.config.server.fs?.allow ?? [];
      server.middlewares.use(
        OPEN_IN_EDITOR_PATH,
        createOpenInEditorMiddleware([ctx.root(), ...fsAllow])
      );
    },
    transform(code, id, transformOptions) {
      if (!ctx.get().sourceOverlay) return null;
      if (!ctx.shouldTransform(id, transformOptions)) return null;
      if (!code.includes('customElement') && !code.includes('customElements')) {
        return null;
      }
      const ms = new MagicString(code);
      const [file] = id.split('?', 1);
      const relativeFile = ctx.relativeToRoot(file);
      if (!injectSourceMeta(code, relativeFile, ms)) {
        return null;
      }
      return {code: ms.toString(), map: ms.generateMap({hires: true})};
    },
    transformIndexHtml() {
      const {sourceOverlay} = ctx.get();
      if (!sourceOverlay) return;
      const overlayUrl = `/@fs/${resolveRuntimeModule('source-overlay')}`;
      const {
        exclude: _exclude,
        onSelect: _onSelect,
        ...overlayInit
      } = sourceOverlay;
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
      if (!ctx.get().hmrEnabled) {
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
      if (ctx.get().hmrEnabled && id.startsWith(VIRTUAL_PREFIX)) {
        return id;
      }
      return null;
    },
    load(id) {
      if (!ctx.get().hmrEnabled || !id.startsWith(VIRTUAL_PREFIX)) {
        return null;
      }
      if (id === INSTALL_ID) {
        const patchPath = resolveRuntimeModule('patch');
        const runtimeOptions = {
          reconnect: ctx.get().reconnect,
          onIncompatible: ctx.get().onIncompatible,
          childState: ctx.get().childState,
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
      if (!ctx.get().hmrEnabled) {
        return null;
      }
      if (!ctx.shouldTransform(id, transformOptions)) {
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

      const indicator = ctx.get().indicator;
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

      if (ctx.get().timeline) {
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
    ctx.plugin,
    litCssQueries(() => ctx.get().cssSheetBuild),
    litTimelineVirtual(() => ctx.get().timeline),
    litCssLiterals(),
    litPrivateFields(ctx),
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
        enabled: () => ctx.get().timeline,
        features: () => toFeatureSettings(ctx.get()),
        // Only a named editor counts: `toFeatureSettings` reports `vscode`
        // for "never chose", which must not turn into a forced `code`.
        configuredEditor: () => {
          const so = ctx.get().sourceOverlay;
          return so !== false && typeof so.editor === 'string'
            ? so.editor
            : undefined;
        },
      })
    );
  }
  return plugins;
};
