/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync} from 'node:fs';
import {resolve as resolvePath, sep} from 'node:path';

/** Why {@link confineToRoots} refused a path. */
export type ConfineFailure = 'outside' | 'missing';

/**
 * Resolve `file` against the first of `roots` and accept it only if it lands
 * at or beneath one of them and exists. Every caller hands the result to
 * `launch-editor`, which spawns the developer's editor on it, so this is the
 * boundary that keeps a request from opening arbitrary files (absolute paths,
 * `../` traversal, a sibling directory that merely shares a root's prefix).
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
  const allowed = resolvedRoots.some(
    (root) => path === root || path.startsWith(root + sep)
  );
  if (!allowed) return {failure: 'outside'};
  if (!existsSync(path)) return {failure: 'missing'};
  return {path};
};
