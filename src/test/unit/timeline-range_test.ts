import {describe, expect, test} from 'vite-plus/test';
import {toSpans} from '../../lib/timeline/derive.js';
import {TimelineModel} from '../../lib/timeline/model.js';
import {
  describeRange,
  fitRange,
  formatRangeParam,
  formatMs,
  inRange,
  moveEdge,
  normalizeRange,
  parseRangeParam,
  summarizeRange,
} from '../../lib/timeline/range.js';
import {timeScale} from '../../lib/timeline/tracks.js';
import type {TimelineEvent} from '../../types/timeline.js';

/** One component tick: a `performUpdate` span of `ms` starting at `time`. */
const tick = (
  elementId: number,
  tag: string,
  time: number,
  ms: number
): TimelineEvent[] =>
  (['start', 'end'] as const).map((edge) => ({
    id: `${elementId}-${time}-${edge}`,
    layerId: 'lit-lifecycle',
    time: edge === 'start' ? time : time + ms,
    groupId: `${elementId}:${time}`,
    title: `performUpdate:${edge}`,
    data: {},
    meta: {elementId, tagName: tag},
  }));

const click = (id: string, time: number): TimelineEvent => ({
  id,
  layerId: 'mouse',
  time,
  title: 'click',
  data: {},
});

const events = [
  ...tick(1, 'x-a', 0, 2),
  click('c1', 5),
  ...tick(1, 'x-a', 10, 4),
  ...tick(2, 'x-b', 12, 1),
  click('c2', 30),
];
const spans = toSpans(events);

describe('normalizeRange', () => {
  test('orders the ends', () => {
    expect(normalizeRange(9, 3)).toEqual({start: 3, end: 9});
  });
  test('a click or a non-number is no range', () => {
    expect(normalizeRange(4, 4)).toBeNull();
    expect(normalizeRange(NaN, 4)).toBeNull();
  });
});

describe('summarizeRange', () => {
  test('counts a span when it starts inside, both ends inclusive', () => {
    const range = {start: 5, end: 12};
    expect(spans.filter((s) => inRange(s, range)).map((s) => s.start)).toEqual([
      5, 10, 12,
    ]);
  });

  test('counts per layer and rolls components up over the range', () => {
    const s = summarizeRange(spans, {start: 5, end: 20});
    expect(s.durationMs).toBe(15);
    expect(s.spanCount).toBe(3);
    expect(s.layers).toEqual([
      {layerId: 'lit-lifecycle', count: 2},
      {layerId: 'mouse', count: 1},
    ]);
    expect(s.components.map((c) => [c.tagName, c.updates, c.totalMs])).toEqual([
      ['x-a', 1, 4],
      ['x-b', 1, 1],
    ]);
  });

  test('an empty window summarises to nothing', () => {
    const s = summarizeRange(spans, {start: 100, end: 200});
    expect(s.spanCount).toBe(0);
    expect(s.layers).toEqual([]);
    expect(s.components).toEqual([]);
  });
});

describe('fitRange', () => {
  test('puts the range across the plot with a margin', () => {
    const range = {start: 10, end: 20};
    const {zoom, pan} = fitRange(0, 100, range);
    const scale = timeScale(0, 100, 500, zoom, pan);
    expect(scale.start).toBeLessThan(10);
    expect(scale.end).toBeGreaterThan(20);
    expect(scale.end - scale.start).toBeLessThan(12);
  });
});

describe('formatMs', () => {
  test('picks a unit', () => {
    expect(formatMs(0.25)).toBe('250µs');
    expect(formatMs(12.34)).toBe('12.3ms');
    expect(formatMs(1500)).toBe('1.50s');
    expect(describeRange({start: 1, end: 3})).toBe('1.0ms–3.0ms (2.0ms)');
  });
});

describe('range on the model', () => {
  const model = () => {
    const m = new TimelineModel();
    m.setEvents(events);
    return m;
  };

  test('drawing a range drops the span selection', () => {
    const m = model();
    m.select(spans[0]!.key);
    m.setRange(20, 5);
    expect(m.range).toEqual({start: 5, end: 20});
    expect(m.selectedKey).toBeNull();
    m.setRange(null);
    expect(m.range).toBeNull();
  });

  test('a zero-width drag clears it', () => {
    const m = model();
    m.setRange(5, 20);
    m.setRange(7, 7);
    expect(m.range).toBeNull();
  });

  test("the range filter narrows both presentations' spans", () => {
    const m = model();
    m.setFilter({range: {start: 5, end: 12}});
    expect(m.filteredSpans.map((s) => s.start)).toEqual([5, 10, 12]);
    m.setFilter({range: null});
    expect(m.filteredSpans).toHaveLength(spans.length);
  });

  test('Clear drops the range and the range filter', () => {
    const m = model();
    m.setRange(5, 20);
    m.setFilter({range: {start: 5, end: 20}});
    m.setEvents([]);
    expect(m.range).toBeNull();
    expect(m.filter.range).toBeNull();
  });
});

describe('moveEdge', () => {
  const bounds = {min: 0, max: 100};
  const range = {start: 20, end: 60};

  test('moves one edge and leaves the other', () => {
    expect(moveEdge(range, 'start', 30, bounds, 1)).toEqual({
      start: 30,
      end: 60,
    });
    expect(moveEdge(range, 'end', 70, bounds, 1)).toEqual({
      start: 20,
      end: 70,
    });
  });

  test('stays inside the recording', () => {
    expect(moveEdge(range, 'start', -5, bounds, 1).start).toBe(0);
    expect(moveEdge(range, 'end', 500, bounds, 1).end).toBe(100);
  });

  test('never crosses the other edge or collapses to nothing', () => {
    expect(moveEdge(range, 'start', 90, bounds, 2)).toEqual({
      start: 58,
      end: 60,
    });
    expect(moveEdge(range, 'end', 0, bounds, 2)).toEqual({
      start: 20,
      end: 22,
    });
  });

  test('ignores a non-finite target', () => {
    expect(moveEdge(range, 'end', NaN, bounds, 1)).toBe(range);
  });
});

describe('range params', () => {
  test('round trip, widened outward to the microsecond', () => {
    expect(formatRangeParam({start: 1.0004, end: 2.0004})).toBe('1-2.001');
    expect(parseRangeParam('1-2.001')).toEqual({start: 1, end: 2.001});
  });

  test('refuse what is not two different plain numbers', () => {
    for (const bad of ['', '3', '3-3', '-3-4', 'x-4', '1e3-4', ' 1-2']) {
      expect(parseRangeParam(bad)).toBeNull();
    }
  });
});
