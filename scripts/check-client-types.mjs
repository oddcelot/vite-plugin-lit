/**
 * @license
 * Copyright 2026 Oddsquad
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Type-checks the `client.d.ts` consumer fixture.
//
// `client.d.ts` ships the ambient declaration for
// `virtual:lit-plugin/timeline`, but the root program can't prove it works:
// it excludes `src/test/**`, and it sees `client.d.ts` as one more source
// file rather than the way a consumer reaches it. The fixture's own tsconfig
// pulls it in the way a consumer's `types` entry does, so compiling the
// fixture is the check — it fails on the `TS2307` this is all here to
// prevent, and on an incompatible drift between `client.d.ts`'s copy of the
// timeline types and `src/types/timeline.ts`.

import {spawnSync} from 'node:child_process';

const project = 'src/test/fixtures/client-types/tsconfig.json';
const {status} = spawnSync('pnpm', ['exec', 'tsc', '-p', project], {
  stdio: 'inherit',
});

if (status !== 0) {
  console.error(
    `[@oddsquad/vite-plugin-lit] client.d.ts does not type-check for a consumer (${project})`
  );
  process.exit(status ?? 1);
}
