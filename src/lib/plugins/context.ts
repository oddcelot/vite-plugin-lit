import {
  isAbsolute,
  relative as relativePath,
  resolve as resolvePath,
  sep,
} from 'node:path';
import {loadEnv, type Plugin} from 'vite';
import {
  ENV_PREFIX,
  type LitPluginOptions,
  type ResolvedOptions,
  resolveOptions,
} from '../options.js';
import {JS_FILE_RE} from './shared.js';

/**
 * The one place plugin options are resolved. Feature plugins hold a reference
 * to it, read {@link OptionsContext.get} inside their hooks, and gate
 * themselves on the result, so no plugin is chosen from options at
 * construction time (env is only loaded once Vite hands over the mode).
 */
export interface OptionsContext {
  /**
   * Always-applied, `enforce: 'pre'` plugin that loads the env and resolves
   * the options in its `config` hook, and records the project root in
   * `configResolved`. Register it first.
   */
  readonly plugin: Plugin;
  /**
   * The resolved options. Before the `config` hook has run this is a pass
   * against an empty env (explicit options and defaults only), which covers
   * a plugin driven without Vite.
   */
  get(): ResolvedOptions;
  /** Vite's resolved project root, `''` before `configResolved`. */
  root(): string;
  /**
   * The guard every source transform shares: not an SSR pass, not a virtual
   * or encoded-virtual id, not under `node_modules`, and either a JS/TS file
   * or an inline script extracted from HTML (`?html-proxy`).
   */
  shouldTransform(id: string, transformOptions?: {ssr?: boolean}): boolean;
  /**
   * `file` relative to the project root (forward slashes) when it lies inside
   * it, otherwise `file` unchanged.
   */
  relativeToRoot(file: string): string;
}

const SKIPPED_ID = /^\0|__x00__|lit-plugin:|[\\/]node_modules[\\/]/;

export const createOptionsContext = (
  options: LitPluginOptions
): OptionsContext => {
  let resolved: ResolvedOptions | undefined;
  let root = '';

  const plugin: Plugin = {
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
    configResolved(config) {
      root = config.root;
    },
  };

  return {
    plugin,
    get: () => (resolved ??= resolveOptions(options, {})),
    root: () => root,
    shouldTransform(id, transformOptions) {
      if (transformOptions?.ssr) return false;
      if (SKIPPED_ID.test(id)) return false;
      const query = id.indexOf('?');
      const file = query === -1 ? id : id.slice(0, query);
      return (
        JS_FILE_RE.test(file) ||
        (query !== -1 && id.slice(query).includes('html-proxy'))
      );
    },
    relativeToRoot(file) {
      if (root === '') return file;
      const rel = relativePath(root, file);
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) return file;
      if (isAbsolute(rel)) return file;
      return rel.split(sep).join('/');
    },
  };
};
