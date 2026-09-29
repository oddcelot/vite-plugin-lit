import {beforeEach, describe, expect, test, vi} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';

// The module keeps its queue and hot client in module scope.
const fresh = async () => {
  vi.resetModules();
  return import('../../lib/runtime/timeline/transport.js');
};

const ev = (n: number) => ({id: `e-${n}`}) as unknown as TimelineEvent;

const fakeHot = () => {
  const sent: Array<[string, {events: TimelineEvent[]}]> = [];
  return {
    sent,
    send: vi.fn((channel: string, data?: unknown) => {
      sent.push([channel, data as {events: TimelineEvent[]}]);
    }),
  };
};

const ids = (events: TimelineEvent[]) => events.map((e) => e.id);
const tick = () => Promise.resolve();

let transport: Awaited<ReturnType<typeof fresh>>;

beforeEach(async () => {
  transport = await fresh();
});

describe('with a hot client', () => {
  test('coalesces a synchronous burst into one message', async () => {
    const hot = fakeHot();
    transport.setHotClient(hot);
    transport.emit(ev(1));
    transport.emit(ev(2));
    transport.emit(ev(3));
    expect(hot.send).not.toHaveBeenCalled();
    await tick();
    expect(hot.send).toHaveBeenCalledTimes(1);
    expect(hot.sent[0]![0]).toBe('lit:timeline:push-event');
    expect(ids(hot.sent[0]![1].events)).toEqual(['e-1', 'e-2', 'e-3']);
  });

  test('events in a later turn go out as a separate message', async () => {
    const hot = fakeHot();
    transport.setHotClient(hot);
    transport.emit(ev(1));
    await tick();
    transport.emit(ev(2));
    await tick();
    expect(hot.send).toHaveBeenCalledTimes(2);
    expect(ids(hot.sent[1]![1].events)).toEqual(['e-2']);
  });

  test('a throwing send drops that batch and later events still go out', async () => {
    const hot = fakeHot();
    hot.send.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });
    transport.setHotClient(hot);
    transport.emit(ev(1));
    await tick();
    transport.emit(ev(2));
    await tick();
    expect(hot.send).toHaveBeenCalledTimes(2);
    expect(ids(hot.sent[0]![1].events)).toEqual(['e-2']);
  });
});

describe('before a hot client is set', () => {
  test('queues events and flushes them in order once the client arrives', async () => {
    transport.emit(ev(1));
    transport.emit(ev(2));
    await tick();
    const hot = fakeHot();
    transport.setHotClient(hot);
    expect(hot.send).not.toHaveBeenCalled();
    await tick();
    expect(hot.send).toHaveBeenCalledTimes(1);
    expect(ids(hot.sent[0]![1].events)).toEqual(['e-1', 'e-2']);
  });

  test('queued and new events emitted before the flush share one message', async () => {
    transport.emit(ev(1));
    const hot = fakeHot();
    transport.setHotClient(hot);
    transport.emit(ev(2));
    await tick();
    expect(hot.send).toHaveBeenCalledTimes(1);
    expect(ids(hot.sent[0]![1].events)).toEqual(['e-1', 'e-2']);
  });

  test('setting a client with nothing queued sends nothing', async () => {
    const hot = fakeHot();
    transport.setHotClient(hot);
    await tick();
    expect(hot.send).not.toHaveBeenCalled();
  });

  test('keeps only the newest 1000 events', async () => {
    for (let i = 0; i < 1500; i++) transport.emit(ev(i));
    const hot = fakeHot();
    transport.setHotClient(hot);
    await tick();
    const sent = hot.sent[0]![1].events;
    expect(sent).toHaveLength(1000);
    expect(sent[0]!.id).toBe('e-500');
    expect(sent[999]!.id).toBe('e-1499');
  });

  test('exactly 1000 events are all retained', async () => {
    for (let i = 0; i < 1000; i++) transport.emit(ev(i));
    const hot = fakeHot();
    transport.setHotClient(hot);
    await tick();
    expect(hot.sent[0]![1].events).toHaveLength(1000);
    expect(hot.sent[0]![1].events[0]!.id).toBe('e-0');
  });
});

describe('setHotClientCallback', () => {
  test('waits for the client, then fires once', () => {
    const cb = vi.fn();
    transport.setHotClientCallback(cb);
    expect(cb).not.toHaveBeenCalled();
    transport.setHotClient(fakeHot());
    expect(cb).toHaveBeenCalledTimes(1);
    transport.setHotClient(fakeHot());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('fires on the next microtask when the client is already set', async () => {
    transport.setHotClient(fakeHot());
    const cb = vi.fn();
    transport.setHotClientCallback(cb);
    expect(cb).not.toHaveBeenCalled();
    await tick();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('runs callbacks in registration order', () => {
    const order: number[] = [];
    transport.setHotClientCallback(() => order.push(1));
    transport.setHotClientCallback(() => order.push(2));
    transport.setHotClient(fakeHot());
    expect(order).toEqual([1, 2]);
  });

  test('a throwing callback does not stop the rest', () => {
    const later = vi.fn();
    transport.setHotClientCallback(() => {
      throw new Error('boom');
    });
    transport.setHotClientCallback(later);
    expect(() => transport.setHotClient(fakeHot())).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });
});
