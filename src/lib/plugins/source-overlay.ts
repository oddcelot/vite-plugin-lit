import MagicString from 'magic-string';
import type {Plugin} from 'vite';
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
});
