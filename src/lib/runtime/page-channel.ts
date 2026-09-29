/**
 * The page runtime's one seam to whatever carries its traffic to the DevTools
 * server. Every `lit:*` message the runtime sends or receives (timeline
 * events, inspector data and commands, settings overrides, HMR-incompatibility
 * notices) goes through {@link pageChannel}, never through `import.meta.hot`
 * directly, so the carrier can be swapped without touching a call site.
 *
 * The default carrier is Vite's HMR channel ({@link fromViteHot}). An
 * alternative (see `rpc-transport.ts`) is attached with
 * {@link PageChannel.attach}; listeners registered earlier move over to it.
 *
 * Vite's own lifecycle events (`vite:afterUpdate`, `vite:beforeFullReload`,
 * `vite:ws:*`) are not part of this channel: they describe the HMR connection
 * itself, so the sites that care still read `import.meta.hot` for those.
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

export interface PageChannel extends PageTransport {
  /** Whether a carrier is attached. Sends made before one is are dropped. */
  readonly attached: boolean;
  /** The carrier in use, so a replacement can hand the channel back. */
  readonly transport: PageTransport | undefined;
  /**
   * Make `transport` the carrier. Listeners already registered are moved onto
   * it and removed from the previous carrier, and `onAttach` callbacks run so
   * their owners can announce themselves to the new peer.
   */
  attach(transport: PageTransport): void;
  /** Attach Vite's HMR client, unless a carrier is already in place. */
  useViteHot(hot: ViteHotLike): void;
  /** Run `callback` on every later {@link attach}. Not run for past ones. */
  onAttach(callback: () => void): void;
}

const createPageChannel = (): PageChannel => {
  let transport: PageTransport | undefined;
  const listeners: Array<{
    channel: string;
    handler: (data: unknown) => void;
    off?: () => void;
  }> = [];
  const attachCallbacks: Array<() => void> = [];

  const bind = (entry: (typeof listeners)[number]): void => {
    entry.off = transport?.on(entry.channel, entry.handler);
  };

  const channel: PageChannel = {
    get attached() {
      return transport !== undefined;
    },
    get transport() {
      return transport;
    },
    send(name, data) {
      transport?.send(name, data);
    },
    on(name, handler) {
      const entry: (typeof listeners)[number] = {channel: name, handler};
      listeners.push(entry);
      bind(entry);
      return () => {
        entry.off?.();
        const index = listeners.indexOf(entry);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
    attach(next) {
      for (const entry of listeners) entry.off?.();
      transport = next;
      for (const entry of listeners) bind(entry);
      for (const callback of attachCallbacks) {
        try {
          callback();
        } catch {
          // One owner failing to announce must not strand the rest.
        }
      }
    },
    useViteHot(hot) {
      if (transport === undefined) channel.attach(fromViteHot(hot));
    },
    onAttach(callback) {
      attachCallbacks.push(callback);
    },
  };
  return channel;
};

// One channel per page even if this module is loaded twice (for instance once
// through Vite's dependency optimizer and once directly), like the patch state.
const CHANNEL_KEY = Symbol.for('@lit-labs/vite-plugin-lit#page-channel');

const shared = globalThis as unknown as Record<symbol, PageChannel | undefined>;

export const pageChannel: PageChannel = (shared[CHANNEL_KEY] ??=
  createPageChannel());
