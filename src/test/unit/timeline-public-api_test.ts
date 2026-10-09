import {afterEach, beforeEach, expect, test, vi} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';

// App code stamps custom events with `performance.now()`, the only clock it
// can read; the panel lays every event out on the recording's clock. The
// public API converts between the two so custom events line up with Lit's.

let perf = 0;

const load = async () => {
  vi.resetModules();
  const clock = await import('../../lib/runtime/timeline/clock.js');
  const transport = await import('../../lib/runtime/timeline/transport.js');
  const api = await import('../../lib/runtime/timeline/public-api.js');
  const sent: TimelineEvent[] = [];
  transport.setHotClient({
    send: (_channel: string, data?: unknown) => {
      sent.push(...(data as {events: TimelineEvent[]}).events);
    },
  });
  return {clock, api, sent};
};

beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => perf);
});
afterEach(() => {
  vi.restoreAllMocks();
});

test('a performance.now() time is moved onto the recording clock', async () => {
  const {clock, api, sent} = await load();
  perf = 1000;
  clock.resetClock();
  api.addTimelineEvent({layerId: 'router', time: 1250, data: {}});
  await Promise.resolve();
  expect(sent[0]?.time).toBe(250);
});

test('an event without a time is stamped when it is added', async () => {
  const {clock, api, sent} = await load();
  perf = 1000;
  clock.resetClock();
  perf = 1300;
  api.addTimelineEvent({layerId: 'router', data: {}});
  await Promise.resolve();
  expect(sent[0]?.time).toBe(300);
});
