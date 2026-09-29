/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The playground's Vite dev server, started through Vite's JavaScript API
 * rather than `vp dev`.
 *
 *     npm run dev                              # in this directory
 *
 * This is what StackBlitz runs. The `vp` CLI loads a native binding with no
 * WebAssembly build, so it cannot start in a WebContainer; Vite itself (the
 * `vite` alias, vite-plus-core) falls back to rolldown's WebAssembly build.
 * From the repo root, `pnpm dev` runs `vp dev playground` as before.
 */

import {createServer} from 'vite';

const server = await createServer({root: import.meta.dirname});
await server.listen();
server.printUrls();

const url = server.resolvedUrls?.local[0];
if (url) {
  console.log(`\n  Lit DevTools panel on its own: ${new URL('__lit/', url)}\n`);
}
