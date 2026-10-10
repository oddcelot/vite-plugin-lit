import type {Plugin} from 'vite';
import {createLitDevframePlugin} from './devframe/vite.js';
import {PACKAGE_VERSION} from './devframe/paths.js';
import {
  type LitPluginOptions,
  configuredEditor,
  toFeatureSettings,
} from './options.js';
import {createOptionsContext} from './plugins/context.js';
import {litCssQueries} from './plugins/css-queries.js';
import {litTimelineVirtual} from './plugins/timeline-virtual.js';
import {litCssLiterals} from './plugins/css-literals.js';
import {litPrivateFields} from './plugins/private-fields.js';
import {litSourceOverlay} from './plugins/source-overlay.js';
import {litHmr} from './plugins/hmr.js';
import {litDevtoolsWorkspace} from './plugins/devtools-workspace.js';
import {litManifestLinks} from './plugins/manifest-links.js';
import {litComponentDocs} from './plugins/component-docs.js';
import {createSourceDocsIndex} from './component-docs/source-index.js';

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
  // Every feature plugin is registered unconditionally and gates itself on
  // `ctx.get()` inside its hooks: env is only loaded in the context's `config`
  // hook, after this array is built, so nothing can be chosen from options
  // here. The context's plugin goes first so it resolves before the others.
  // The project's own components, documented from source as Vite transforms
  // them; read by the devframe's `componentDocs` action.
  const sourceDocs = createSourceDocsIndex((id) => ctx.locator().toWire(id));
  const devtools = options.timeline !== false;
  const plugins: Plugin[] = [
    ctx.plugin,
    litCssQueries(() => ctx.get().cssSheetBuild),
    litTimelineVirtual(() => ctx.get().timeline),
    litCssLiterals(),
    litPrivateFields(ctx),
    // Before the source overlay, which rewrites the code it has to read.
    ...(devtools
      ? [litComponentDocs(ctx, sourceDocs, () => ctx.get().timeline)]
      : []),
    litSourceOverlay(ctx),
    litHmr(ctx),
    litDevtoolsWorkspace(ctx),
    litManifestLinks(ctx),
  ];
  // The one construction-time decision. An explicit `timeline: false` is final
  // (env can't override it), so it keeps the devframe plugin out of Vite
  // DevTools entirely. Anything else may still be switched on by env in the
  // context's `config` hook (83bf4f5), so the plugin is included and its
  // `setup()` skips mounting while `enabled()` stays false.
  if (devtools) {
    plugins.push(
      createLitDevframePlugin({
        version: PACKAGE_VERSION,
        enabled: () => ctx.get().timeline,
        features: () => toFeatureSettings(ctx.get()),
        configuredEditor: () => configuredEditor(ctx.get()),
        sourceLocator: () => ctx.locator(),
        sourceDocs: () => sourceDocs,
      })
    );
  }
  return plugins;
};
