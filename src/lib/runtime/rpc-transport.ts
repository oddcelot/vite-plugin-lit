/**
 * Carries the page channel over devframe RPC to a standalone
 * `lit-devtools dev` server, so a page that is not served by a DevTools-enabled
 * Vite dev server can still feed the panel. The server half is
 * `devframe/rpc-source.ts`.
 *
 * Opt-in and explicit: nothing connects until {@link connectToDevServer} is
 * called, and `devframe/client` is only imported then, so a page that never
 * asks pays nothing.
 */

import {
  LIT_DEVFRAME_ID,
  RPC_PAGE_RECEIVE,
  RPC_PAGE_SEND,
} from '../devframe/protocol.js';
import type {ConnectionMeta} from 'devframe';
import {pageChannel} from './page-channel.js';
import type {PageTransport} from './page-channel.js';

/** The slice of a scoped devframe client the transport uses. */
export interface PageRpc {
  callEvent(method: string, ...args: unknown[]): void;
  register(fn: {
    name: string;
    type: 'event';
    handler: (...args: any[]) => void;
  }): void;
}

/**
 * A {@link PageTransport} over a devframe RPC client: `send` becomes a
 * `page-send` event, and `page-receive` events fan out to the listeners
 * registered with `on`.
 */
export const createRpcTransport = (rpc: PageRpc): PageTransport => {
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  rpc.register({
    name: RPC_PAGE_RECEIVE,
    type: 'event',
    handler: (channel: string, data?: unknown) => {
      for (const listener of listeners.get(channel) ?? []) {
        try {
          listener(data);
        } catch (error) {
          console.error(`[lit-devtools] listener for ${channel} threw`, error);
        }
      }
    },
  });

  return {
    send(channel, data) {
      rpc.callEvent(RPC_PAGE_SEND, channel, data);
    },
    on(channel, handler) {
      let set = listeners.get(channel);
      if (set === undefined) listeners.set(channel, (set = new Set()));
      set.add(handler);
      return () => void set.delete(handler);
    },
  };
};

export interface ConnectOptions {
  /**
   * A bearer token the server already trusts. Without one the client falls
   * back to devframe's own flow (a stored token, a magic-link code in the URL,
   * or a prompt for the one-time code the server prints) unless the server was
   * started with `--no-auth`.
   */
  authToken?: string;
  /**
   * The server's connection descriptor (what it serves at
   * `<url>/__connection.json`). Passing it skips that fetch, which is the
   * step a cross-origin page cannot make: the server sends no CORS headers,
   * and a classic script tag is exempt from them where `fetch` is not.
   */
  connectionMeta?: ConnectionMeta;
}

/**
 * Point this page's runtime at a standalone `lit-devtools dev` server.
 *
 * Resolves once the connection is trusted, after which the tree, inspector
 * and timeline traffic that used to go to this page's own Vite server goes to
 * `url` instead (the runtime announces itself again so the server can replay
 * recording state). Returns a function that disconnects and hands the channel
 * back to the carrier it replaced.
 *
 * The page's origin must be allowed to reach `url`; this does not set up
 * cross-origin access.
 *
 * @param url Origin of the dev server, e.g. `http://localhost:5180/`.
 */
export const connectToDevServer = async (
  url: string,
  options: ConnectOptions = {}
): Promise<() => void> => {
  const {getDevframeRpcClient} = await import('devframe/client');
  const client = await getDevframeRpcClient({
    baseURL: url,
    authToken: options.authToken,
    connectionMeta: options.connectionMeta,
  });
  await client.ensureTrusted();

  const previous = pageChannel.transport;
  pageChannel.attach(createRpcTransport(client.scope(LIT_DEVFRAME_ID).rpc));

  return () => {
    client.close?.();
    if (previous !== undefined) pageChannel.attach(previous);
  };
};
