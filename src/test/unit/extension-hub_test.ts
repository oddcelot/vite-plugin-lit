import {describe, expect, test} from 'vite-plus/test';
import {createHub} from '../../../extension/src/hub.js';
import type {HubPort} from '../../../extension/src/hub.js';

// A `chrome.runtime.Port` stand-in: records what the hub posts to it and lets
// a test play the far end (send a message, hang up).
const fakePort = (
  name: string,
  sender?: {tab?: {id?: number}; frameId?: number}
) => {
  const received: unknown[] = [];
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  let open = true;
  const port: HubPort & {
    received: unknown[];
    open: boolean;
    send(message: unknown): void;
    hangUp(): void;
  } = {
    name,
    sender,
    received,
    get open() {
      return open;
    },
    postMessage(message) {
      if (!open) throw new Error('Attempting to use a disconnected port');
      received.push(message);
    },
    onMessage: {addListener: (cb) => void messageListeners.push(cb)},
    onDisconnect: {addListener: (cb) => void disconnectListeners.push(cb)},
    // Chrome does not fire onDisconnect on the side that disconnects.
    disconnect() {
      open = false;
    },
    send(message) {
      for (const cb of messageListeners) cb(message);
    },
    hangUp() {
      open = false;
      for (const cb of disconnectListeners) cb();
    },
  };
  return port;
};

const page = (tabId: number, frameId = 0) =>
  fakePort('lit-page', {tab: {id: tabId}, frameId});

const panel = (tabId: number) => {
  const port = fakePort('lit-panel');
  return {port, hello: () => port.send({tabId})};
};

const status = (connected: boolean) => ({
  channel: 'lit-ext:page',
  data: {connected},
});

describe('extension hub', () => {
  test('pairs a page and a panel on the same tab, both ways', () => {
    const hub = createHub();
    const p = page(1);
    const {port: q, hello} = panel(1);
    hub.connect(p);
    hub.connect(q);
    hello();
    expect(q.received).toEqual([status(true)]);

    p.send({channel: 'lit:timeline-event', data: {n: 1}});
    expect(q.received.at(-1)).toEqual({
      channel: 'lit:timeline-event',
      data: {n: 1},
    });
    q.send({channel: 'lit:inspect-cmd', data: {type: 'tree'}});
    expect(p.received).toEqual([
      {channel: 'lit:inspect-cmd', data: {type: 'tree'}},
    ]);
  });

  test('tells a panel that came first when the page connects', () => {
    const hub = createHub();
    const {port: q, hello} = panel(1);
    hub.connect(q);
    hello();
    expect(q.received).toEqual([status(false)]);
    hub.connect(page(1));
    expect(q.received).toEqual([status(false), status(true)]);
  });

  test('drops what a panel sends before its hello, and while no page is up', () => {
    const hub = createHub();
    const {port: q, hello} = panel(1);
    hub.connect(q);
    q.send({channel: 'lit:inspect-cmd'});
    hello();
    q.send({channel: 'lit:inspect-cmd'});
    const p = page(1);
    hub.connect(p);
    expect(p.received).toEqual([]);
  });

  test('a navigation swaps the page port without losing the panel', () => {
    const hub = createHub();
    const before = page(1);
    const {port: q, hello} = panel(1);
    hub.connect(before);
    hub.connect(q);
    hello();

    // The new document can connect before the old one's port reports gone.
    const after = page(1);
    hub.connect(after);
    before.hangUp();
    expect(q.received).toEqual([status(true), status(true)]);

    q.send({channel: 'lit:inspect-cmd'});
    expect(before.received).toEqual([]);
    expect(after.received).toEqual([{channel: 'lit:inspect-cmd'}]);

    after.hangUp();
    expect(q.received.at(-1)).toEqual(status(false));
  });

  test('keeps routing to the page once the panel goes', () => {
    const hub = createHub();
    const p = page(1);
    const first = panel(1);
    const second = panel(1);
    hub.connect(p);
    hub.connect(first.port);
    first.hello();
    hub.connect(second.port);
    second.hello();

    first.port.hangUp();
    p.send({channel: 'lit:timeline-event'});
    expect(first.port.received).toEqual([status(true)]);
    expect(second.port.received.at(-1)).toEqual({
      channel: 'lit:timeline-event',
    });

    second.port.hangUp();
    expect(() => p.send({channel: 'lit:timeline-event'})).not.toThrow();
  });

  test('keeps tabs apart', () => {
    const hub = createHub();
    const p1 = page(1);
    const p2 = page(2);
    const q1 = panel(1);
    const q2 = panel(2);
    for (const port of [p1, p2, q1.port, q2.port]) hub.connect(port);
    q1.hello();
    q2.hello();

    p1.send({channel: 'one'});
    p2.send({channel: 'two'});
    q2.port.send({channel: 'to-two'});
    expect(q1.port.received).toEqual([status(true), {channel: 'one'}]);
    expect(q2.port.received).toEqual([status(true), {channel: 'two'}]);
    expect(p1.received).toEqual([]);
    expect(p2.received).toEqual([{channel: 'to-two'}]);

    p1.hangUp();
    expect(q2.port.received.at(-1)).toEqual({channel: 'two'});
  });

  test('turns away subframes, tabless senders and stray messages', () => {
    const hub = createHub();
    const frame = page(1, 3);
    const tabless = fakePort('lit-page', {frameId: 0});
    hub.connect(frame);
    hub.connect(tabless);
    expect(frame.open).toBe(false);
    expect(tabless.open).toBe(false);

    const {port: q, hello} = panel(1);
    hub.connect(q);
    hello();
    expect(q.received).toEqual([status(false)]);

    const p = page(1);
    hub.connect(p);
    p.send('not a port message');
    p.send({data: 1});
    expect(q.received).toEqual([status(false), status(true)]);
  });

  test('ignores ports it does not own', () => {
    const hub = createHub();
    const other = fakePort('someone-else', {tab: {id: 1}, frameId: 0});
    hub.connect(other);
    expect(other.open).toBe(true);
    expect(other.received).toEqual([]);
  });
});
