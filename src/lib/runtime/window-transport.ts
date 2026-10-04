/**
 * The page channel across the two worlds of a browser extension. The runtime
 * lives in the page's MAIN world, which has no `chrome.runtime`; the content
 * script in the ISOLATED world has one but cannot share objects with the page.
 * The only thing both see is the window's message stream, so the runtime talks
 * over `window.postMessage` ({@link windowPageTransport}) and the content
 * script pipes that to a `chrome.runtime.Port` ({@link relayWindowToPort}),
 * whose other end is the DevTools panel's local host (see `port-link.ts`).
 *
 * Every message is an {@link Envelope} tagged with {@link SOURCE} and a
 * direction, because both worlds receive every message on the window,
 * including their own, and so does the page's own code. Each end drops its
 * own direction and anything that is not an envelope, and only listens to
 * messages whose `event.source` is the window they listen on.
 *
 * Trust: the page can read and forge all of this. That is acceptable, since
 * the page is the data source anyway. What matters is that a forged envelope
 * can do nothing a page could not already do through the port: the relay only
 * forwards `{channel, data}` to the port, which the panel treats as page
 * traffic, and it never interprets `data`. Conversely everything the panel
 * sends is readable by the page, so the panel must not send anything secret.
 *
 * Window messages are structured-cloned and port messages JSON-serialized;
 * every `lit:*` payload is already JSON-safe (the Vite HMR channel needs it),
 * so there is no extra serialization step.
 *
 * Late connects: the panel may open after the page booted, or close and open
 * again. The relay announces itself with a `connected` control message when it
 * starts, and answers the page's `hello` the same way, so the page re-attaches
 * and the runtime re-announces itself ({@link attachWindowTransport}). Page
 * sends made before any relay exists are dropped, which that re-announce
 * covers. A relay whose port outlives a panel (the extension opens it per
 * document, not per panel) says `connected` again whenever the port brings
 * {@link PEER_CONNECTED_CHANNEL}.
 */

import {pageChannel} from './page-channel.js';
import type {PageTransport} from './page-channel.js';
import type {PortLike, PortMessage} from '../devframe/port-message.js';
import {channelListeners} from './channel-listeners.js';
import {PEER_CONNECTED_CHANNEL} from '../devframe/protocol.js';

/** Marks window messages as ours among all other `postMessage` traffic. */
export const SOURCE = '@oddsquad/vite-plugin-lit';

/** A `lit:*` message on its way to the extension or back to the page. */
interface DataEnvelope {
  source: typeof SOURCE;
  dir: 'to-extension' | 'to-page';
  channel: string;
  data?: unknown;
}

/**
 * Handshake: `connected` (relay to page) says a peer is listening now;
 * `hello` (page to relay) asks for that, for a page that booted after it.
 */
interface ControlEnvelope {
  source: typeof SOURCE;
  dir: 'control';
  type: 'connected' | 'hello';
}

export type Envelope = DataEnvelope | ControlEnvelope;

/**
 * The envelope in `event`, if it is one of ours posted from the window the
 * listener is on. `currentTarget` stands for that window: it is the same
 * object as `event.source` for a same-window message, and unlike a captured
 * `window` it also holds where a global is wrapped (happy-dom).
 */
export const envelopeOf = (event: MessageEvent): Envelope | undefined => {
  if (event.source !== event.currentTarget) return undefined;
  const message = event.data as Partial<Envelope> | null;
  if (typeof message !== 'object' || message === null) return undefined;
  if (message.source !== SOURCE) return undefined;
  if (message.dir === 'control') {
    return message.type === 'connected' || message.type === 'hello'
      ? (message as ControlEnvelope)
      : undefined;
  }
  if (message.dir !== 'to-extension' && message.dir !== 'to-page') {
    return undefined;
  }
  return typeof message.channel === 'string'
    ? (message as DataEnvelope)
    : undefined;
};

// The target is this very window, so `'*'` cannot reach anyone else; naming
// the origin would only break pages with an opaque one (`null`, sandboxed).
const post = (target: Window, envelope: Envelope): void =>
  target.postMessage(envelope, '*');

export interface WindowPageTransportOptions {
  /** The window to talk through. Defaults to `window`. */
  target?: Window;
  /** Called each time a relay announces itself, first or again. */
  onPeerConnected?: () => void;
}

/** MAIN world: a PageTransport over window.postMessage to the extension's content script. */
export const windowPageTransport = (
  options: WindowPageTransportOptions = {}
): PageTransport => {
  const target = options.target ?? window;
  const listeners = channelListeners();
  target.addEventListener('message', (event) => {
    const envelope = envelopeOf(event);
    if (envelope === undefined) return;
    if (envelope.dir === 'control') {
      if (envelope.type === 'connected') options.onPeerConnected?.();
      return;
    }
    if (envelope.dir === 'to-page')
      listeners.emit(envelope.channel, envelope.data);
  });
  // A relay that started before this page script ran has already said
  // `connected` to nobody; ask again.
  post(target, {source: SOURCE, dir: 'control', type: 'hello'});
  return {
    send: (channel, data) =>
      post(target, {source: SOURCE, dir: 'to-extension', channel, data}),
    on: listeners.on,
  };
};

/**
 * MAIN world entry: make the window the runtime's carrier, and re-attach it
 * whenever a relay (re)connects so the runtime announces itself to the new
 * peer. Re-attaching the same transport is safe: `pageChannel.attach` unbinds
 * its listeners before binding them again.
 */
export const attachWindowTransport = (target?: Window): PageTransport => {
  const transport: PageTransport = windowPageTransport({
    target,
    onPeerConnected: () => pageChannel.attach(transport),
  });
  pageChannel.attach(transport);
  return transport;
};

/** ISOLATED world: pipe the page's window messages to `port` and back. Returns a stop function. */
export const relayWindowToPort = (
  target: Window,
  port: PortLike
): (() => void) => {
  let stopped = false;
  const announce = () =>
    post(target, {source: SOURCE, dir: 'control', type: 'connected'});

  const stop = () => {
    if (stopped) return;
    stopped = true;
    target.removeEventListener('message', onWindow);
  };

  function onWindow(event: MessageEvent): void {
    const envelope = envelopeOf(event);
    if (envelope === undefined) return;
    if (envelope.dir === 'control') {
      if (envelope.type === 'hello') announce();
      return;
    }
    if (envelope.dir !== 'to-extension') return;
    const message: PortMessage = {
      channel: envelope.channel,
      data: envelope.data,
    };
    try {
      port.postMessage(message);
    } catch {
      stop();
    }
  }

  target.addEventListener('message', onWindow);
  port.onMessage.addListener((message) => {
    if (stopped) return;
    const {channel, data} = (message ?? {}) as Partial<PortMessage>;
    if (typeof channel !== 'string') return;
    if (channel === PEER_CONNECTED_CHANNEL) return announce();
    post(target, {source: SOURCE, dir: 'to-page', channel, data});
  });
  port.onDisconnect?.addListener(stop);
  announce();
  return stop;
};
