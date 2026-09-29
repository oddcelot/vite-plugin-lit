/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The playground's Vite dev server for StackBlitz, started through Vite's
 * JavaScript API rather than `vp dev`.
 *
 *     npm run stackblitz                       # in this directory
 *
 * StackBlitz runs it as the `startCommand`. The `vp` CLI loads a native
 * binding with no WebAssembly build, so it cannot start in a WebContainer;
 * Vite itself (the `vite` alias, vite-plus-core) falls back to rolldown's
 * WebAssembly build. Everywhere else, use `npm run dev` (`vp dev`).
 */

import {createServer} from 'vite';

const server = await createServer({root: import.meta.dirname});
await server.listen();
server.printUrls();
