/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Package-root resolution for the devframe.
 *
 * `tsc` flattens `src/lib/devframe/*.ts` to `lib/devframe/*.js`, so a path
 * relative to `import.meta.url` lands one directory apart depending on
 * whether the module was loaded from source (tests, `vite dev` on this repo)
 * or from the published output. Walking up to the nearest `package.json`
 * instead is correct in both layouts — the same reason
 * `resolveRuntimeModule()` in plugin.ts probes for both extensions.
 */

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const findPackageRoot = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url));
  // 6 levels is more than either layout needs; the loop exits at the root.
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('[lit-plugin] could not locate the package root');
};

/** Absolute path of this package's root directory. */
export const PACKAGE_ROOT: string = findPackageRoot();

/** This package's version, as published. Surfaced by the `get-meta` query. */
export const PACKAGE_VERSION: string =
  (
    JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    }
  ).version ?? '0.0.0';

/** Where `vp run build:panel` writes the panel SPA the host serves. */
export const PANEL_DIST_DIR: string = join(PACKAGE_ROOT, 'dist', 'client');
