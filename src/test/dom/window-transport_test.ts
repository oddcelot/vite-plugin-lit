import {expect, test, vi} from 'vite-plus/test';
import {LitElement, html} from 'lit';
import type {PortLike} from '../../lib/devframe/port-link.js';
import {
  SOURCE,
  attachWindowTransport,
  relayWindowToPort,
  windowPageTransport,
} from '../../lib/runtime/window-transport.js';
import type {InspectorTreeNode} from '../../types/inspector.js';

// The extension's page-to-panel chain, with the world boundary in the middle:
// the runtime posts on `window` (MAIN world), a relay pipes the window to a
// port (ISOLATED world), and the Lit devframe runs in-process on the far end.
// happy-dom's `postMessage` sets `event.source` to the window itself, as a
// browser does for a same-window message, so the source filter runs as is.

/** Lets queued window messages (macrotasks) and port deliveries (microtasks) land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Two linked ports, JSON round-tripped like Chrome's, with a `disconnect()`
 * that fires `onDisconnect` on both ends and makes `postMessage` throw.
 */
const portPair = () => {
  let open = true;
  const disconnects: Array<() => void> = [];
  const end = () => ({
    listeners: [] as Array<(message: unknown) => void>,
  });
  const a = end();
  const b = end();
  const make = (self: ReturnType<typeof end>, peer: typeof self): PortLike => ({
    postMessage(message: unknown) {
      if (!open) throw new Error('Attempting to use a disconnected port');
      const wire = JSON.stringify(message);
      queueMicrotask(() => {
        for (const listener of peer.listeners) listener(JSON.parse(wire));
      });
    },
    onMessage: {addListener: (cb) => self.listeners.push(cb)},
    onDisconnect: {addListener: (cb) => disconnects.push(cb)},
  });
  return {
    ports: [make(a, b), make(b, a)] as [PortLike, PortLike],
    disconnect() {
      open = false;
      for (const cb of disconnects) cb();
    },
  };
};

// What any script on the page can do: a same-window message with a forged body.
const post = (message: unknown) => window.postMessage(message, '*');

test('a page send reaches the port as a bare {channel, data}', async () => {
  const {ports} = portPair();
  const received: unknown[] = [];
  ports[1].onMessage.addListener((m) => received.push(m));
  const stop = relayWindowToPort(window, ports[0]);

  windowPageTransport().send('lit:test', {n: 1});
  await settle();
  expect(received).toEqual([{channel: 'lit:test', data: {n: 1}}]);
  stop();
});

test('port messages come back to the page transport listeners', async () => {
  const {ports} = portPair();
  const stop = relayWindowToPort(window, ports[0]);
  const transport = windowPageTransport();
  const handler = vi.fn();
  const off = transport.on('lit:down', handler);

  ports[1].postMessage({channel: 'lit:down', data: 'hi'});
  await settle();
  expect(handler).toHaveBeenCalledExactlyOnceWith('hi');

  off();
  ports[1].postMessage({channel: 'lit:down', data: 'again'});
  await settle();
  expect(handler).toHaveBeenCalledOnce();
  stop();
});

test('foreign and own-direction window messages are ignored', async () => {
  const {ports} = portPair();
  const received: unknown[] = [];
  ports[1].onMessage.addListener((m) => received.push(m));
  const stop = relayWindowToPort(window, ports[0]);
  const handler = vi.fn();
  windowPageTransport().on('lit:x', handler);

  const mine = {source: SOURCE, dir: 'to-extension', channel: 'lit:x'};
  post({channel: 'lit:x', data: 1}); // no tag
  post({...mine, source: 'someone-else'});
  post({...mine, channel: 7}); // bad channel
  post({...mine, dir: 'sideways'});
  post(null);
  post('lit:x');
  window.dispatchEvent(
    new MessageEvent('message', {data: mine, source: {} as Window}) // another window
  );
  post({source: SOURCE, dir: 'control', type: 'bogus'});
  // The relay ignores to-page, the page transport ignores to-extension.
  post({...mine, dir: 'to-page'});
  await settle();
  expect(received).toEqual([]);
  expect(handler).toHaveBeenCalledTimes(1); // only the to-page one
  post(mine);
  await settle();
  expect(received).toEqual([{channel: 'lit:x'}]);
  expect(handler).toHaveBeenCalledTimes(1);
  stop();
});

test('a stopped relay forwards nothing and a disconnect stops it', async () => {
  const first = portPair();
  const second = portPair();
  const seen: string[] = [];
  first.ports[1].onMessage.addListener(() => seen.push('first'));
  second.ports[1].onMessage.addListener(() => seen.push('second'));
  const transport = windowPageTransport();
  const handler = vi.fn();
  transport.on('lit:down', handler);

  const stop = relayWindowToPort(window, first.ports[0]);
  relayWindowToPort(window, second.ports[0]);
  stop();
  transport.send('lit:up');
  first.ports[1].postMessage({channel: 'lit:down'});
  await settle();
  expect(seen).toEqual(['second']);
  expect(handler).not.toHaveBeenCalled();

  second.disconnect();
  transport.send('lit:up');
  await settle();
  expect(seen).toEqual(['second']);
});

test('a relay announcing itself makes the page re-announce', async () => {
  const onPeerConnected = vi.fn();
  windowPageTransport({onPeerConnected});
  await settle();
  expect(onPeerConnected).not.toHaveBeenCalled();

  // Started after the page: the announcement is the late-connect signal.
  const stop = relayWindowToPort(window, portPair().ports[0]);
  await settle();
  expect(onPeerConnected).toHaveBeenCalledTimes(1);
  stop();
});

class WindowGreeting extends LitElement {
  override render() {
    return html`<p>Hello</p>`;
  }
}
customElements.define('x-window-greeting', WindowGreeting);

const findTag = (
  nodes: readonly InspectorTreeNode[],
  tag: string
): InspectorTreeNode | undefined => {
  for (const node of nodes) {
    if (node.tagName === tag) return node;
    const inner = findTag(node.children, tag);
    if (inner) return inner;
  }
  return undefined;
};

test('the panel lists components through window, relay, port and local host, connecting late and again', async () => {
  const el = document.createElement('x-window-greeting') as WindowGreeting;
  document.body.append(el);
  await el.updateComplete;

  const {createLocalLitHost} = await import('../../lib/devframe/port-link.js');

  // The page boots first, with no relay and no panel anywhere.
  attachWindowTransport();
  await import('../../lib/runtime/inspector/install.js');
  await settle();

  const connect = async () => {
    const link = portPair();
    const client = await createLocalLitHost({
      port: link.ports[1],
      version: '9.9.9',
    });
    const stop = relayWindowToPort(window, link.ports[0]);
    await settle();
    return {client, stop, link};
  };
  const listed = async (
    client: Awaited<ReturnType<typeof connect>>['client']
  ) =>
    findTag(
      (await client
        .scope('lit')
        .rpc.call('list-components')) as InspectorTreeNode[],
      'x-window-greeting'
    );

  const first = await connect();
  expect(await listed(first.client)).toBeDefined();

  // The panel closes and a new one opens on a new port.
  first.link.disconnect();
  const second = await connect();
  expect(await listed(second.client)).toBeDefined();
  second.stop();
});
