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
