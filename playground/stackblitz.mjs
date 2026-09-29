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
 *
 * StackBlitz also serves every port from its own origin,
 * `https://<slug>--<port>--<hash>.<zone>.webcontainer-api.io`, known only
 * once the project boots. The DevTools WebSocket admits loopback origins and
 * exact `allowedOrigins` entries, so the page's own origin is turned away
 * (403) and the dock never connects. An origin registry, the shape devframe
 * asks per origin, lets that domain in as well; `lit-devtools dev
 * --allow-origin 'https://*.webcontainer-api.io'` does the same for the
 * standalone script.
 *
 * The dock also refuses to mount in any frame (`window.parent !== window`),
 * which keeps it out of its own panels but also out of StackBlitz's split
 * view, where the preview is an iframe in the editor. When the parent is
 * cross-origin, which the dock's own panels never are, the page shadows
 * `window.parent` with itself before the dock loads. An experiment, to go
 * once devframes skips only its own frames.
 */

import {createServer} from 'vite';

const LOOPBACK =
  /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;
const WEBCONTAINER =
  /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.webcontainer-api\.io$/i;

// Runs before any other script in <head>. Reading a cross-origin parent's
// location throws; `parent` is [Replaceable], so the assignment shadows it.
const unframeDock = `try {
  window.parent.location.href;
} catch {
  window.parent = window;
}`;

const server = await createServer({
  root: import.meta.dirname,
  plugins: [
    {
      name: 'playground:stackblitz-unframe-dock',
      transformIndexHtml: () => [
        {tag: 'script', children: unframeDock, injectTo: 'head-prepend'},
      ],
    },
  ],
  devtools: {
    allowedOrigins: {
      // Nothing registers through this list; random so it is never a
      // guessable constant.
      token: crypto.randomUUID(),
      registerFromUrl: () => undefined,
      // No `Origin` header is a non-browser client, allowed by default too.
      isAllowed: (origin) =>
        origin === undefined ||
        LOOPBACK.test(origin) ||
        WEBCONTAINER.test(origin),
    },
  },
});
await server.listen();
server.printUrls();
