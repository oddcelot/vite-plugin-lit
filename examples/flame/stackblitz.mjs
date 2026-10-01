/**
 * The example's dev server for StackBlitz, started through Vite's JavaScript
 * API rather than the `vite` command, which does not start in a
 * WebContainer. The playground's `stackblitz.mjs` does the same; this one
 * leaves out its DevTools workarounds, since the example runs no DevTools.
 *
 *     npm run stackblitz
 *
 * StackBlitz runs it as the `startCommand`. Everywhere else, use
 * `npm run dev`.
 */

import {createServer} from 'vite';

const server = await createServer({root: import.meta.dirname});
await server.listen();
server.printUrls();
