/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * Resolves a runtime module to an absolute fs path (served via `/@fs/`), so
 * the plugin works from any served root. Falls back from the built `.js` to
 * the `.ts` source when running un-built (e.g. under vitest).
 */
export const resolveRuntimeModule = (name: string): string => {
  for (const ext of ['js', 'ts'] as const) {
    const url = new URL(`../runtime/${name}.${ext}`, import.meta.url);
    if (existsSync(url)) {
      return fileURLToPath(url).replace(/\\/g, '/');
    }
  }
  throw new Error(`[lit-plugin] runtime module not found: ${name}`);
};

export const JS_FILE_RE = /\.[cm]?[jt]sx?$/;
