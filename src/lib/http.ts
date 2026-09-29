/**
 * Headers the trust check looks at. Both the open-in-editor endpoint and the
 * timeline/inspector endpoints are local-only dev tooling: only the page the
 * dev server itself served may drive them.
 */
export interface TrustHeaders {
  origin?: string;
  host?: string;
  'sec-fetch-site'?: string;
}

/**
 * True when the request demonstrably comes from the dev server's own page.
 *
 * Two independent signals, because neither is present on every request:
 *   - `Origin` is sent on CORS-mode fetches and on every non-GET/HEAD request,
 *     but NOT on a plain cross-site GET (`<img>`, `<iframe>`, a navigation).
 *   - `Sec-Fetch-Site` is sent by Chromium and Firefox on every request and is
 *     the signal that covers exactly that gap; `same-origin` and `none` (a
 *     user-typed URL) are ours, `cross-site`/`same-site` are not.
 * A request is trusted only when every signal it does carry says same-origin,
 * and at least one of them is present.
 *
 * This does not stop DNS rebinding, where a hostile page reaches the server
 * under its own name and `Origin` and `Host` agree. Vite's
 * `server.allowedHosts` check does, and it runs before any plugin middleware,
 * so this doesn't repeat it (source-overlay_test pins that ordering).
 */
export const isTrustedRequest = (headers: TrustHeaders): boolean => {
  const site = headers['sec-fetch-site'];
  if (site !== undefined) {
    if (site !== 'same-origin' && site !== 'none') return false;
  }
  const {origin, host} = headers;
  if (origin !== undefined && origin !== 'null') {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
    return true;
  }
  // No `Origin`: trust only when `Sec-Fetch-Site` vouched for it above.
  return site !== undefined;
};
