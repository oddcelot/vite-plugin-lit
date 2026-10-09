/**
 * Which URL the browser loaded for a source file the plugin stamped.
 *
 * The plugin stamps a component with the file's path on disk, and DevTools'
 * Sources panel only knows URLs. Vite serves a file inside the project root
 * at its root-relative path and one outside it under `/@fs/`, so the path
 * can be matched against the URLs the page loaded without knowing the root.
 * Pure, so it is tested without a browser.
 */

const pathnameOf = (url: string): string | undefined => {
  try {
    const {pathname} = new URL(url);
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  } catch {
    return undefined;
  }
};

/**
 * The URL among `urls` that serves `file`, or `undefined`. Query and hash are
 * ignored (`?t=` stamps and `?v=` hashes change per load). A URL matches as
 * `/@fs` plus the absolute path, or as a root-relative pathname the path ends
 * with (`/src/x.ts` for `/home/me/app/src/x.ts`); the longest pathname wins,
 * so `/src/x.ts` beats a bare `/x.ts`, and `/` never matches.
 */
export const loadedUrlFor = (
  file: string,
  urls: readonly string[]
): string | undefined => {
  const path = file.startsWith('/') ? file : `/${file}`;
  let best: {url: string; length: number} | undefined;
  for (const url of urls) {
    const pathname = pathnameOf(url);
    if (pathname === undefined || pathname === '/') continue;
    if (
      (pathname === `/@fs${path}` || path.endsWith(pathname)) &&
      (best === undefined || pathname.length > best.length)
    ) {
      best = {url, length: pathname.length};
    }
  }
  return best?.url;
};
