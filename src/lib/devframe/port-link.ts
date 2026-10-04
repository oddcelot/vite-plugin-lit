/**
 * The page channel over a `chrome.runtime.Port`, for the browser extension:
 * the page runtime's traffic reaches the DevTools panel through a port the
 * extension relays, and the panel runs the Lit devframe in-process (see
 * `local-host.ts`) instead of dialling a dev server.
 *
 * Both ends speak one message shape, {@link PortMessage}: the
 * {@link PageTransport} channel name and its payload, nothing else. Chrome
 * JSON-serializes everything posted on a port, so a payload has to survive
 * `JSON.stringify` -- which every `lit:*` message already does, since the
 * Vite HMR channel has the same constraint.
 *
 * Nothing here imports `chrome`: a port is anything shaped like {@link PortLike},
 * which keeps this testable with a fake pair and usable over any relay
 * (a content script forwarding `window.postMessage`, say).
 */

import type {PageTransport} from '../runtime/page-channel.js';
import {channelListeners} from '../runtime/channel-listeners.js';
import {
  isPortMessage,
  type PortLike,
  type PortMessage,
} from './port-message.js';
import {createLocalHost} from './local-host.js';
import type {KeyValueStorage, LocalDevframeClient} from './local-host.js';
import {createStandaloneLitDevframe} from './rpc-source.js';
import type {PageLinkNode} from './rpc-source.js';

export type {PortLike, PortMessage} from './port-message.js';

/**
 * `postMessage` that stops once the port disconnects: Chrome throws on a
 * disconnected port, and a closed tab or panel is not an error.
 */
const poster = (
  port: PortLike
): ((channel: string, data?: unknown) => void) => {
  let connected = true;
  port.onDisconnect?.addListener(() => {
    connected = false;
  });
  return (channel, data) => {
    if (!connected) return;
    const message: PortMessage = {channel, data};
    try {
      port.postMessage(message);
    } catch {
      connected = false;
    }
  };
};

/**
 * The panel's end: a {@link PageLinkNode} for
 * {@link RpcTimelineSource.bind}. One port is one page.
 */
export const portPageLink = (port: PortLike): PageLinkNode => {
  const post = poster(port);
  return {
    onPageMessage(handler) {
      port.onMessage.addListener((message) => {
        if (isPortMessage(message)) handler(message.channel, message.data);
      });
    },
    sendToPages: post,
  };
};

/** The page's end: a {@link PageTransport} for `pageChannel.attach()`. */
export const portPageTransport = (port: PortLike): PageTransport => {
  const post = poster(port);
  const listeners = channelListeners();
  port.onMessage.addListener((message) => {
    if (isPortMessage(message)) listeners.emit(message.channel, message.data);
  });
  return {send: post, on: listeners.on};
};

export interface LocalLitHostOptions {
  /** The panel's end of the port to the inspected page. */
  port: PortLike;
  /** Surfaced by `get-meta`, as on every host. */
  version: string;
  /** Where the panel's settings persist; in memory when omitted. */
  storage?: KeyValueStorage;
}

/**
 * The whole panel-side host for one inspected page: the Lit devframe, fed by
 * the page on `port`, running in this realm. Hand the result to the panel
 * with `useLocalClient()` (`panel/client.ts`).
 *
 * Resolve this before the page end attaches: the runtime announces itself on
 * attach, and messages that arrive before the definition's `setup()` has
 * finished are dropped, as on every other host.
 */
export const createLocalLitHost = (
  options: LocalLitHostOptions
): Promise<LocalDevframeClient> =>
  createLocalHost(
    createStandaloneLitDevframe(
      // No server behind this host, so no Node actions: no editor to
      // launch and no disk to write a snapshot to.
      {host: 'extension', version: options.version},
      () => portPageLink(options.port)
    ),
    {storage: options.storage}
  );
