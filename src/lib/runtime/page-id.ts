/**
 * One id per document, shared by every runtime module in the page. The node
 * side follows a single page; this is how it tells two tabs of the same app
 * apart, since the HMR channel is a broadcast with no sender. Kept on
 * `globalThis` under a well-known symbol so a module loaded twice (dep
 * optimizer plus direct import) still reports one id -- same reasoning as
 * `page-channel.ts`.
 */
const PAGE_ID_KEY = Symbol.for('@oddsquad/vite-plugin-lit#page-id');
const shared = globalThis as unknown as Record<symbol, string | undefined>;

const mint = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const PAGE_ID: string = (shared[PAGE_ID_KEY] ??= mint());

const TAB_ID_KEY = '@oddsquad/vite-plugin-lit#tab-id';

/**
 * One id per browser tab, surviving reloads: it lets the node side tell "this
 * tab reloaded" from "another tab opened", which both mint a new `PAGE_ID`.
 * Kept in `sessionStorage`, which can throw (sandboxed iframes, privacy
 * modes); then it falls back to `PAGE_ID`, so a reload reads as another page.
 * A duplicated tab copies `sessionStorage` and so shares its source's id; it
 * reads as a reload of that tab, which is an accepted edge case.
 */
const readTabId = (): string => {
  try {
    const stored = sessionStorage.getItem(TAB_ID_KEY);
    if (stored !== null && stored !== '') return stored;
    sessionStorage.setItem(TAB_ID_KEY, PAGE_ID);
  } catch {
    // Storage unavailable.
  }
  return PAGE_ID;
};

export const TAB_ID: string = readTabId();
