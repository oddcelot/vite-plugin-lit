import type {Plugin} from 'vite';
import {INSTALL_ID, VIRTUAL_PREFIX, transformLitModule} from '../transform.js';
import {WRAP_TABLE} from '../wrap-table.js';
import type {OptionsContext} from './context.js';
import {resolveRuntimeModule} from './shared.js';

/**
 * HMR plugin: wrapper/install virtual modules, the Lit import rewrite and the
 * indicator/timeline runtime scripts. Always registered; the hooks that
 * change anything gate on the context's resolved options, so a feature that
 * is off adds no module, script or optimizeDeps entry.
 */
export const litHmr = (ctx: OptionsContext): Plugin => ({
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
      injectTo: 'body' | 'head-prepend';
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
      // Ahead of everything else: Lit makes the warnings Set when it loads,
      // and a module script in the head runs before the app's in the body.
      tags.unshift({
        tag: 'script',
        attrs: {
          type: 'module',
          src: `/@fs/` + resolveRuntimeModule('timeline/warnings-boot'),
        },
        injectTo: 'head-prepend',
      });
      const installUrl = `/@fs/` + resolveRuntimeModule('timeline/install');
      tags.push({
        tag: 'script',
        attrs: {type: 'module', src: installUrl},
        injectTo: 'body',
      });
      // Components inspector runtime — answers the panel's tree/details
      // requests. Paired with the timeline panel, which hosts its tab.
      const inspectorUrl = `/@fs/` + resolveRuntimeModule('inspector/install');
      tags.push({
        tag: 'script',
        attrs: {type: 'module', src: inspectorUrl},
        injectTo: 'body',
      });
    }

    return tags.length > 0 ? tags : undefined;
  },
});
