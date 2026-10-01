import * as nodePath from 'node:path';
import {confineToRoots} from './confine.js';
import type {ConfineFailure, ConfineOptions} from './confine.js';

/**
 * The wire format for source files, both directions.
 *
 * The transform stamps each component with its file (`ElementSource.file`),
 * the page and panel carry that string around, and an open request hands it
 * back to the server to launch an editor on. On the wire the path is relative
 * to the project root with forward slashes, so it reads the same on every OS
 * and in a snapshot taken on another machine; a file outside the root (a
 * sibling package in a monorepo) stays absolute.
 *
 * Built from plain directories, so the devframe definition can take one
 * without importing Vite.
 */
export interface SourceLocator {
  /** Absolute roots, primary first. Opens are confined beneath these. */
  readonly roots: readonly string[];
  /** `file` as it goes on the wire: root-relative when inside the primary
   *  root, otherwise unchanged. */
  toWire(file: string): string;
  /**
   * The absolute path a wire path names, if it lies at or beneath one of the
   * roots. See {@link confineToRoots}: the result is handed to an editor
   * launcher, so this is the boundary for traversal and symlinks.
   */
  resolve(
    wire: string,
    options?: ConfineOptions
  ): {path: string} | {failure: ConfineFailure};
}

/** The parts of a resolved Vite config the roots come from. */
export interface SourceRootsConfig {
  root: string;
  server: {fs?: {allow?: readonly string[]}};
}

/**
 * The project root, then everything Vite itself is willing to serve
 * (`server.fs.allow` defaults to the workspace root). In a monorepo,
 * component sources regularly live in sibling packages outside the served
 * app's root.
 */
export const sourceRootsOf = (config: SourceRootsConfig): string[] => [
  config.root,
  ...(config.server.fs?.allow ?? []),
];

/**
 * A locator over `roots`, the first of which wire paths are relative to.
 * With no roots, `toWire` changes nothing and `resolve` refuses everything.
 * `platform` picks the path flavour, so the Windows conversion can be tested
 * on any OS; it defaults to the host's.
 */
export const createSourceLocator = (
  roots: readonly string[],
  platform?: 'posix' | 'win32'
): SourceLocator => {
  const path = platform === undefined ? nodePath : nodePath[platform];
  const resolved = roots.map((root) => path.resolve(root));
  const primary = resolved[0];
  return {
    roots: resolved,
    toWire(file) {
      if (primary === undefined) return file;
      const rel = path.relative(primary, file);
      if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`)) {
        return file;
      }
      // A different drive on Windows comes back absolute.
      if (path.isAbsolute(rel)) return file;
      return rel.split(path.sep).join('/');
    },
    resolve: (wire, options) => confineToRoots(resolved, wire, options),
  };
};
