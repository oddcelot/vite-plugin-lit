import {beforeEach, describe, expect, test, vi} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';

// The panel's RPC client has no injection seam (it dials devframe from the page
// URL), so this one import is replaced.
const rpcState = vi.hoisted(() => ({
  snapshot: false,
  call: undefined as unknown as (name: string, arg?: unknown) => Promise<any>,
  subscribe: undefined as unknown as () => AsyncIterable<unknown>,
  connectError: undefined as unknown,
}));

vi.mock('../../panel/client.js', () => ({
  litRpc: async () => {
    if (rpcState.connectError) throw rpcState.connectError;
    return {
      rpc: {
        call: (name: string, arg?: unknown) => rpcState.call(name, arg),
        streaming: {subscribe: () => rpcState.subscribe()},
      },
    };
  },
  getMeta: async () => ({stream: {channel: 'ch', id: 'sid'}}),
  isSnapshot: () => rpcState.snapshot,
  describeError: (err: unknown) => `described:${(err as Error).message}`,
}));

const CLEARED_KEY = 'lit-devtools:timeline-cleared-through';

const ev = (id: string | undefined): TimelineEvent =>
  ({id, type: 'test'}) as unknown as TimelineEvent;

// A stream the test feeds by hand: push() delivers a batch, end() closes it.
const controlledStream = () => {
  const batches: unknown[][] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(batch: unknown[]) {
      batches.push(batch);
      wake?.();
    },
    end() {
      closed = true;
      wake?.();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          if (batches.length > 0) yield batches.shift()!;
          else if (closed) return;
          else await new Promise<void>((r) => (wake = r));
        }
      },
    } as AsyncIterable<unknown>,
  };
};

const fakeSessionStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const load = async () => {
  vi.resetModules();
  return import('../../panel/timeline-store.js');
};

let stream: ReturnType<typeof controlledStream>;
let history: TimelineEvent[];

beforeEach(() => {
  vi.unstubAllGlobals();
  stream = controlledStream();
  history = [];
  rpcState.snapshot = false;
  rpcState.connectError = undefined;
  rpcState.subscribe = () => stream.iterable;
  rpcState.call = async (name) => {
    if (name === 'timeline-history') return history;
    if (name === 'recent-events') return {events: history};
    throw new Error(`unexpected ${name}`);
  };
  vi.stubGlobal('sessionStorage', fakeSessionStorage());
});

describe('timeline store', () => {
  test('starts empty with no error', async () => {
    const store = await load();
    expect(store.getTimelineEvents()).toEqual([]);
    expect(store.getTimelineError()).toBeNull();
  });

  test('seeds from history and appends streamed batches', async () => {
    history = [ev('e-1'), ev('e-2')];
    const store = await load();
    const listener = vi.fn();
    store.subscribeTimeline(listener);
    await flush();
    expect(store.getTimelineEvents().map((e) => e.id)).toEqual(['e-1', 'e-2']);

    stream.push([ev('e-3')]);
    await flush();
    expect(store.getTimelineEvents().map((e) => e.id)).toEqual([
      'e-1',
      'e-2',
      'e-3',
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('replaces the events array instead of mutating it', async () => {
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    stream.push([ev('e-1')]);
    await flush();
    const before = store.getTimelineEvents();
    stream.push([ev('e-2')]);
    await flush();
    expect(store.getTimelineEvents()).not.toBe(before);
    expect(before).toHaveLength(1);
  });

  test('drops streamed events already delivered by the history seed', async () => {
    history = [ev('e-1'), ev('e-2')];
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    stream.push([ev('e-2'), ev('e-3')]);
    await flush();
    expect(store.getTimelineEvents().map((e) => e.id)).toEqual([
      'e-1',
      'e-2',
      'e-3',
    ]);
  });

  test('keeps events without an id when they repeat', async () => {
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    stream.push([ev(undefined), ev(undefined)]);
    await flush();
    expect(store.getTimelineEvents()).toHaveLength(2);
  });

  test('does not notify for an empty or fully filtered batch', async () => {
    history = [ev('e-1')];
    const store = await load();
    const listener = vi.fn();
    store.subscribeTimeline(listener);
    await flush();
    listener.mockClear();
    stream.push([]);
    stream.push([ev('e-1')]);
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  test('a failed history call leaves the store empty but still streaming', async () => {
    rpcState.call = async () => {
      throw new Error('nope');
    };
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    stream.push([ev('e-1')]);
    await flush();
    expect(store.getTimelineEvents().map((e) => e.id)).toEqual(['e-1']);
    expect(store.getTimelineError()).toBeNull();
  });

  test('reports a connection failure through getTimelineError', async () => {
    rpcState.connectError = new Error('no host');
    const store = await load();
    const listener = vi.fn();
    store.subscribeTimeline(listener);
    await flush();
    expect(store.getTimelineError()).toBe('described:no host');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('a snapshot reads recent-events once and does not subscribe', async () => {
    rpcState.snapshot = true;
    history = [ev('e-1'), ev('e-2')];
    const subscribe = vi.fn(() => stream.iterable);
    rpcState.subscribe = subscribe;
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    expect(store.getTimelineEvents()).toHaveLength(2);
    expect(subscribe).not.toHaveBeenCalled();
  });

  test('starts the reader only once across subscribers', async () => {
    const subscribe = vi.fn(() => stream.iterable);
    rpcState.subscribe = subscribe;
    const store = await load();
    store.subscribeTimeline(() => {});
    store.subscribeTimeline(() => {});
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  test('unsubscribing stops notifications but not the reader', async () => {
    const store = await load();
    const listener = vi.fn();
    const unsubscribe = store.subscribeTimeline(listener);
    await flush();
    unsubscribe();
    stream.push([ev('e-1')]);
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getTimelineEvents()).toHaveLength(1);
  });
});

describe('MAX_EVENTS cap', () => {
  const many = (from: number, count: number) =>
    Array.from({length: count}, (_, i) => ev(`e-${from + i}`));

  test('keeps the newest 5000 events of the history seed', async () => {
    history = many(0, 5200);
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    const events = store.getTimelineEvents();
    expect(events).toHaveLength(5000);
    expect(events[0]!.id).toBe('e-200');
    expect(events[4999]!.id).toBe('e-5199');
  });

  test('scrolls the oldest events off as streamed batches arrive', async () => {
    history = many(0, 4999);
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    stream.push(many(4999, 3));
    await flush();
    const events = store.getTimelineEvents();
    expect(events).toHaveLength(5000);
    expect(events[0]!.id).toBe('e-2');
    expect(events[4999]!.id).toBe('e-5001');
  });

  test('keeps the newest 5000 events of a snapshot', async () => {
    rpcState.snapshot = true;
    history = many(0, 5001);
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    expect(store.getTimelineEvents()).toHaveLength(5000);
    expect(store.getTimelineEvents()[0]!.id).toBe('e-1');
  });
});

describe('clearing', () => {
  test('clearTimelineEvents empties the buffer, remembers the newest id and notifies', async () => {
    const storage = fakeSessionStorage();
    vi.stubGlobal('sessionStorage', storage);
    history = [ev('a-1'), ev('a-2')];
    const store = await load();
    const listener = vi.fn();
    store.subscribeTimeline(listener);
    await flush();
    listener.mockClear();

    store.clearTimelineEvents();
    expect(store.getTimelineEvents()).toEqual([]);
    expect(storage.data.get(CLEARED_KEY)).toBe('a-2');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('clearing an empty buffer does nothing', async () => {
    const storage = fakeSessionStorage();
    vi.stubGlobal('sessionStorage', storage);
    const store = await load();
    const listener = vi.fn();
    store.subscribeTimeline(listener);
    await flush();
    listener.mockClear();
    store.clearTimelineEvents();
    expect(listener).not.toHaveBeenCalled();
    expect(storage.data.has(CLEARED_KEY)).toBe(false);
  });

  test('a newest event without an id is not remembered', async () => {
    const storage = fakeSessionStorage();
    vi.stubGlobal('sessionStorage', storage);
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    stream.push([ev(undefined)]);
    await flush();
    store.clearTimelineEvents();
    expect(store.getTimelineEvents()).toEqual([]);
    expect(storage.data.has(CLEARED_KEY)).toBe(false);
  });

  test('history at or before the cleared mark of the same epoch is dropped', async () => {
    vi.stubGlobal('sessionStorage', fakeSessionStorage({[CLEARED_KEY]: 'a-2'}));
    history = [ev('a-1'), ev('a-2'), ev('a-3')];
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    expect(store.getTimelineEvents().map((e) => e.id)).toEqual(['a-3']);
  });

  test('streamed events are filtered by the mark as well', async () => {
    vi.stubGlobal('sessionStorage', fakeSessionStorage({[CLEARED_KEY]: 'a-5'}));
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    stream.push([ev('a-4'), ev('a-6')]);
    await flush();
    expect(store.getTimelineEvents().map((e) => e.id)).toEqual(['a-6']);
  });

  test('a mark from another epoch hides nothing', async () => {
    vi.stubGlobal(
      'sessionStorage',
      fakeSessionStorage({[CLEARED_KEY]: 'old-99'})
    );
    history = [ev('new-1'), ev('new-2')];
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    expect(store.getTimelineEvents()).toHaveLength(2);
  });

  test('epochs containing dashes split on the last dash', async () => {
    vi.stubGlobal(
      'sessionStorage',
      fakeSessionStorage({[CLEARED_KEY]: 'x-y-3'})
    );
    history = [ev('x-y-3'), ev('x-y-4'), ev('x-9')];
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    expect(store.getTimelineEvents().map((e) => e.id)).toEqual([
      'x-y-4',
      'x-9',
    ]);
  });

  test.each(['garbage', '-5', 'a-b', 'a-1.5', ''])(
    'an unparsable mark (%j) hides nothing',
    async (mark) => {
      vi.stubGlobal(
        'sessionStorage',
        fakeSessionStorage({[CLEARED_KEY]: mark})
      );
      history = [ev('a-1')];
      const store = await load();
      store.subscribeTimeline(() => {});
      await flush();
      expect(store.getTimelineEvents()).toHaveLength(1);
    }
  );

  test('events with an unparsable id are never filtered out', async () => {
    vi.stubGlobal('sessionStorage', fakeSessionStorage({[CLEARED_KEY]: 'a-9'}));
    history = [ev('nodash'), ev(undefined)];
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    expect(store.getTimelineEvents()).toHaveLength(2);
  });

  test('blocked sessionStorage is tolerated', async () => {
    const blocked = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('sessionStorage', {getItem: blocked, setItem: blocked});
    history = [ev('a-1')];
    const store = await load();
    store.subscribeTimeline(() => {});
    await flush();
    expect(store.getTimelineEvents()).toHaveLength(1);
    expect(() => store.clearTimelineEvents()).not.toThrow();
    expect(store.getTimelineEvents()).toEqual([]);
  });
});
