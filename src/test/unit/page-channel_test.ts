import {describe, expect, test, vi} from 'vite-plus/test';

// The module keeps its channel on `globalThis`, so each test loads a fresh copy
// (after dropping that slot) to get a channel with no listeners or carrier.
const freshChannel = async () => {
  vi.resetModules();
  const g = globalThis as unknown as Record<symbol, unknown>;
  delete g[Symbol.for('@oddsquad/vite-plugin-lit#page-channel')];
  return import('../../lib/runtime/page-channel.js');
};

// A carrier that records what it is asked to do and lets a test play the peer.
const fakeCarrier = () => {
  const sent: Array<[string, unknown]> = [];
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    sent,
    handlers,
    send: (channel: string, data?: unknown) => void sent.push([channel, data]),
    on(channel: string, handler: (data: unknown) => void) {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
      return () => void set.delete(handler);
    },
    deliver(channel: string, data: unknown) {
      for (const handler of handlers.get(channel) ?? []) handler(data);
    },
  };
};

describe('pageChannel', () => {
  test('drops sends until a carrier is attached', async () => {
    const {pageChannel} = await freshChannel();
    expect(pageChannel.attached).toBe(false);
    expect(() => pageChannel.send('a', 1)).not.toThrow();
  });

  test('binds listeners registered before the carrier existed', async () => {
    const {pageChannel} = await freshChannel();
    const seen: unknown[] = [];
    pageChannel.on('a', (d) => seen.push(d));
    const carrier = fakeCarrier();
    pageChannel.attach(carrier);
    carrier.deliver('a', 1);
    pageChannel.send('b', 2);
    expect(seen).toEqual([1]);
    expect(carrier.sent).toEqual([['b', 2]]);
  });

  test('moves listeners to a replacement carrier and unbinds the old one', async () => {
    const {pageChannel} = await freshChannel();
    const seen: unknown[] = [];
    const first = fakeCarrier();
    pageChannel.attach(first);
    pageChannel.on('a', (d) => seen.push(d));
    const second = fakeCarrier();
    pageChannel.attach(second);
    first.deliver('a', 'stale');
    second.deliver('a', 'live');
    expect(seen).toEqual(['live']);
    pageChannel.send('b');
    expect(first.sent).toEqual([]);
    expect(second.sent).toEqual([['b', undefined]]);
  });

  test('a removed listener stays removed across a carrier swap', async () => {
    const {pageChannel} = await freshChannel();
    const seen: unknown[] = [];
    const off = pageChannel.on('a', (d) => seen.push(d));
    off();
    const carrier = fakeCarrier();
    pageChannel.attach(carrier);
    carrier.deliver('a', 1);
    expect(seen).toEqual([]);
  });

  test('onAttach runs for later attaches only, and survives a throwing callback', async () => {
    const {pageChannel} = await freshChannel();
    pageChannel.attach(fakeCarrier());
    const calls: string[] = [];
    pageChannel.onAttach(() => {
      throw new Error('boom');
    });
    pageChannel.onAttach(() => calls.push('second'));
    expect(calls).toEqual([]);
    pageChannel.attach(fakeCarrier());
    expect(calls).toEqual(['second']);
  });

  test('useViteHot yields to a carrier that is already attached', async () => {
    const {pageChannel} = await freshChannel();
    const carrier = fakeCarrier();
    pageChannel.attach(carrier);
    const hotSent: string[] = [];
    pageChannel.useViteHot({
      send: (event) => void hotSent.push(event),
      on: () => {},
    });
    pageChannel.send('a');
    expect(hotSent).toEqual([]);
    expect(carrier.sent).toEqual([['a', undefined]]);
  });

  test('useViteHot wraps the HMR client as the default carrier', async () => {
    const {pageChannel} = await freshChannel();
    const registered: Array<[string, (d: any) => void]> = [];
    const removed: string[] = [];
    const sent: Array<[string, unknown]> = [];
    pageChannel.useViteHot({
      send: (event, data) => void sent.push([event, data]),
      on: (event, cb) => void registered.push([event, cb]),
      off: (event) => void removed.push(event),
    });
    const seen: unknown[] = [];
    const off = pageChannel.on('lit:x', (d) => seen.push(d));
    registered[0][1]('hi');
    pageChannel.send('lit:y', {n: 1});
    off();
    expect(seen).toEqual(['hi']);
    expect(sent).toEqual([['lit:y', {n: 1}]]);
    expect(removed).toEqual(['lit:x']);
  });
});
