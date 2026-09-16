/**
 * @license
 * Copyright 2026 Oddsquad
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Pretty-prints the emitted JS so the published tarball is readable.
//
// The build output is gitignored, and `vp fmt` prunes any glob that descends
// into a gitignored directory — `--ignore-path` only swaps out the
// prettier-style ignore file, it does not disable the VCS-aware walk. Explicit
// file paths bypass that walk, so expand the glob here and pass the files.

import {globSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const files = globSync(['index.js', 'lib/**/*.js']);
if (files.length === 0) {
  console.error('[@oddsquad/vite-plugin-lit] no build output to format');
  process.exit(1);
}

const {status} = spawnSync(
  'vp',
  ['fmt', '--ignore-path', '/dev/null', ...files],
  {stdio: 'inherit', shell: process.platform === 'win32'}
);
process.exit(status ?? 1);
