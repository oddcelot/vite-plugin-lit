import type {Plugin} from 'vite';
import {extractModuleDocs} from '../component-docs/extract.js';
import type {SourceDocsIndex} from '../component-docs/source-index.js';
import type {OptionsContext} from './context.js';

/**
 * Dev-only: reads the docs of the project's own components from each module
 * Vite transforms and keeps them in `index`, which the `componentDocs` node
 * action asks before any manifest. Changes no code.
 *
 * It runs `pre`, and is registered before the source overlay's transform, so
 * it sees the author's TypeScript with its type annotations and decorators
 * intact. HMR re-runs the transform for an edited module, which replaces its
 * entry; a deleted file drops its entry.
 *
 * @param enabled Read per call; off while DevTools is.
 */
export const litComponentDocs = (
  ctx: OptionsContext,
  index: SourceDocsIndex,
  enabled: () => boolean
): Plugin => ({
  name: 'lit-component-docs',
  apply: 'serve',
  enforce: 'pre',
  async transform(code, id, transformOptions) {
    if (!enabled() || !ctx.shouldTransform(id, transformOptions)) return null;
    const module = code.includes('class')
      ? extractModuleDocs(code, id)
      : {classes: []};
    if (module.classes.length === 0) {
      index.delete(id);
      return null;
    }
    // Only imported superclasses need resolving; the index follows the
    // resolved id to the module that declares the base class.
    const specifiers = new Set(
      module.classes.flatMap((cls) => cls.superclass?.specifier ?? [])
    );
    const superclassIds = new Map<string, string>();
    for (const specifier of specifiers) {
      const resolved = await this.resolve(specifier, id);
      if (resolved !== null && resolved.external !== true)
        superclassIds.set(specifier, resolved.id);
    }
    index.set(id, module, superclassIds);
    return null;
  },
  watchChange(id, change) {
    if (change.event === 'delete') index.delete(id);
  },
});
