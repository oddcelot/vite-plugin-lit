/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync, realpathSync} from 'node:fs';
import {resolve as resolvePath, sep} from 'node:path';

/** Why {@link confineToRoots} refused a path. */
export type ConfineFailure = 'outside' | 'missing';

/**
 * Resolve `file` against the first of `roots` and accept it only if it lands
 * at or beneath one of them and exists. Every caller hands the result to
 * `launch-editor`, which spawns the developer's editor on it, so this is the
 * boundary that keeps a request from opening arbitrary files (absolute paths,
 * `../` traversal, a sibling directory that merely shares a root's prefix, a
 * symlink out of the tree).
 * Without roots nothing is allowed.
 */
export const confineToRoots = (
  roots: readonly string[],
  file: string
): {path: string} | {failure: ConfineFailure} => {
  const resolvedRoots = roots.map((root) => resolvePath(root));
  const primary = resolvedRoots[0];
  if (primary === undefined) return {failure: 'outside'};
  const path = resolvePath(primary, file);
  if (!within(resolvedRoots, path)) return {failure: 'outside'};
  if (!existsSync(path)) return {failure: 'missing'};
  // Checked again on the real paths, so a symlink beneath a root can't point
  // the editor outside every root. The caller still gets the path as asked:
  // that's the one the developer recognises.
  const realRoots = resolvedRoots.flatMap((root) => {
    try {
      return [realpathSync(root)];
    } catch {
      return [];
    }
  });
  if (!within(realRoots, realpathSync(path))) return {failure: 'outside'};
  return {path};
};

const within = (roots: readonly string[], path: string): boolean =>
  roots.some((root) => path === root || path.startsWith(root + sep));
