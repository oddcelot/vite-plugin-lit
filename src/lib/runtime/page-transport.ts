/**
 * A pipe for named messages between a page runtime and the DevTools: the one
 * interface on both ends. The page runtime's {@link pageChannel} rides one;
 * the DevTools host's `TimelineChannelCodec` rides another. Adapters: Vite's
 * HMR channel ({@link fromViteHot}, on the page's `import.meta.hot` and the
 * server's `server.hot` alike), devframe RPC events (`rpc-transport.ts`, and
 * `rpcPageTransport` on the host), a `chrome.runtime.Port`
 * (`portPageTransport`) and `window.postMessage` (`window-transport.ts`).
 *
 * Side-effect free, unlike `page-channel.ts`, so a Node host can use the
 * Vite adapter without creating the page's channel.
 */

/** A carrier for named messages between the page runtime and the server. */
export interface PageTransport {
  send(channel: string, data?: unknown): void;
  /** Listen on a channel. Returns the function that removes the listener. */
  on(channel: string, handler: (data: unknown) => void): () => void;
}

/** The slice of `import.meta.hot` the default carrier relies on. */
export interface ViteHotLike {
  send(event: string, data?: unknown): void;
  on(event: string, handler: (data: any) => void): void;
  off?(event: string, handler: (data: any) => void): void;
}

/** Wraps Vite's HMR client as a {@link PageTransport}. */
export const fromViteHot = (hot: ViteHotLike): PageTransport => ({
  send: (channel, data) => hot.send(channel, data),
  on(channel, handler) {
    hot.on(channel, handler);
    return () => hot.off?.(channel, handler);
  },
});
