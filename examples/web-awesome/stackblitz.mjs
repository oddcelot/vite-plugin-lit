/**
 * The example's dev server for StackBlitz, started through Vite's JavaScript
 * API rather than the `vite` command, which does not start in a
 * WebContainer. It is the playground's `stackblitz.mjs`, kept in step.
 *
 *     npm run stackblitz
 *
 * StackBlitz runs it as the `startCommand`. Everywhere else, use
 * `npm run dev`.
 *
 * StackBlitz also serves every port from its own origin,
 * `https://<slug>--<port>--<hash>.<zone>.webcontainer-api.io`, known only
 * once the project boots. The DevTools WebSocket admits loopback origins and
 * exact `allowedOrigins` entries, so the page's own origin would be turned
 * away (403) and the dock never connect. An origin check lets that domain in.
 *
 * The dock also refuses to mount in any frame (`window.parent !== window`),
 * which keeps it out of its own panels but also out of StackBlitz's split
 * view, where the preview is an iframe in the editor. When the parent is
 * cross-origin, which the dock's own panels never are, the page shadows
 * `window.parent` with itself before the dock loads.
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
      name: 'web-awesome:stackblitz-unframe-dock',
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
