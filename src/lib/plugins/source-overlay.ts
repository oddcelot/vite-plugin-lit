import MagicString from 'magic-string';
import type {Plugin} from 'vite';
import {injectCallSites, injectHtmlCallSites} from '../call-sites.js';
import {injectSourceMeta} from '../source-meta.js';
import type {OptionsContext} from './context.js';
import {
  OPEN_IN_EDITOR_PATH,
  createOpenInEditorMiddleware,
} from './open-in-editor.js';
import {resolveRuntimeModule} from './shared.js';

/**
 * Source-overlay plugin: source-meta injection, the open-in-editor
 * middleware and the page bootstrap. Always registered; every hook is inert
 * unless the context resolves `sourceOverlay` (which env may decide).
 */
export const litSourceOverlay = (ctx: OptionsContext): Plugin => ({
  name: 'lit-source-overlay',
  apply: 'serve',
  // Run before Vite's esbuild TS transform so source-meta line numbers are
  // measured against the author's raw source (and the `@customElement … class`
  // forms are still intact), not against transpiled output.
  enforce: 'pre',
  configureServer(server) {
    if (!ctx.get().sourceOverlay) return;
    server.middlewares.use(
      OPEN_IN_EDITOR_PATH,
      createOpenInEditorMiddleware(ctx.locator())
    );
  },
  transform(code, id, transformOptions) {
    if (!ctx.get().sourceOverlay) return null;
    if (!ctx.shouldTransform(id, transformOptions)) return null;
    const hasElements = code.includes('customElement');
    const hasTemplates = code.includes('html`') || code.includes('svg`');
    if (!hasElements && !hasTemplates) return null;
    const ms = new MagicString(code);
    const [file] = id.split('?', 1);
    const wire = ctx.locator().toWire(file);
    // Both work on original offsets, so one MagicString carries both edits.
    let changed = false;
    if (hasElements) changed = injectSourceMeta(code, wire, ms);
    if (hasTemplates)
      changed = injectCallSites(code, file, wire, ms) || changed;
    if (!changed) return null;
    return {code: ms.toString(), map: ms.generateMap({hires: true})};
  },
  transformIndexHtml: {
    // Before other plugins touch the HTML, so the stamped line and column are
    // those of the file as written.
    order: 'pre',
    handler(html, htmlCtx) {
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
      const [file] = htmlCtx.filename.split('?', 1);
      return {
        html: injectHtmlCallSites(html, ctx.locator().toWire(file)) ?? html,
        tags: [
          {
            tag: 'script',
            attrs: {type: 'module'},
            children: `import {initSourceOverlay} from ${JSON.stringify(overlayUrl)};\ninitSourceOverlay(${JSON.stringify(initConfig)});\n`,
            injectTo: 'body',
          },
        ],
      };
    },
  },
});
