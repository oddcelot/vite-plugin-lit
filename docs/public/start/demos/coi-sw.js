/**
 * Makes the Demos page cross-origin isolated. A StackBlitz embed runs a
 * WebContainer only when the page embedding it is isolated
 * (`crossOriginIsolated`) and the iframe is `credentialless`; otherwise it
 * shows "Unable to run Embedded Project". GitHub Pages cannot send the
 * COOP/COEP headers, so this worker adds them to the page's own document.
 *
 * It sits next to the page so its scope is `/start/demos/` and nothing else
 * on the site changes. `credentialless` rather than `require-corp` keeps
 * cross-origin images and scripts loading, without credentials.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim())
);

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })
  );
});
