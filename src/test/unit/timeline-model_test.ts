import {describe, expect, test} from 'vite-plus/test';
import {
  TimelineModel,
  isRawKey,
  rawRow,
  summarizeUpdates,
} from '../../lib/timeline/model.js';
import type {TimelineEvent} from '../../types/timeline.js';

/** A start/end pair of one lifecycle phase, which `toSpans` collapses into
 *  the span keyed `lit-lifecycle:${elementId}:1:${name}`. */
const pair = (
  name: string,
  time: number,
  elementId = 1,
  tag = 'x-a'
): TimelineEvent[] =>
  (['start', 'end'] as const).map((edge, i) => ({
    id: `${elementId}-${name}-${edge}`,
    layerId: 'lit-lifecycle',
    time: time + i,
    groupId: `${elementId}:1`,
    title: `${name}:${edge}`,
    subtitle: tag,
    data: {},
    meta: {elementId, tagName: tag},
  }));

const a = pair('update', 0, 1, 'x-a');
const b = pair('update', 10, 2, 'x-b');
const keyA = 'lit-lifecycle:1:1:update';
const keyB = 'lit-lifecycle:2:1:update';

const modelWith = (events: TimelineEvent[]): TimelineModel => {
  const model = new TimelineModel();
  model.setEvents(events);
  return model;
};

describe('TimelineModel derivation', () => {
  test('derives spans and elements from the buffer', () => {
    const model = modelWith([...a, ...b]);
    expect(model.spans.map((s) => s.key)).toEqual([keyA, keyB]);
    expect(model.elements).toEqual([
      {id: 1, tag: 'x-a'},
      {id: 2, tag: 'x-b'},
    ]);
  });

  test('applies the element and regex filter', () => {
    const model = modelWith([...a, ...b]);
    model.setFilter({elementId: 2});
    expect(model.filteredSpans.map((s) => s.key)).toEqual([keyB]);
    model.setFilter({elementId: null, regex: 'X-A'});
    expect(model.filteredSpans.map((s) => s.key)).toEqual([keyA]);
  });

  test('an invalid regex is reported and filters nothing', () => {
    const model = modelWith([...a, ...b]);
    model.setFilter({regex: 'foo('});
    expect(model.regexInvalid).toBe(true);
    expect(model.filteredSpans).toHaveLength(2);
  });

  test('keeps filteredSpans identity across selection changes', () => {
    const model = modelWith([...a, ...b]);
    const before = model.filteredSpans;
    model.select(keyA);
    model.setFilter({regex: ''});
    expect(model.filteredSpans).toBe(before);
  });

  test('re-setting the same buffer is a no-op', () => {
    const events = [...a];
    const model = modelWith(events);
    const spans = model.spans;
    model.setEvents(events);
    expect(model.spans).toBe(spans);
  });
});

describe('TimelineModel reconcile', () => {
  test('drops a selection that fell out of the buffer', () => {
    const model = modelWith([...a, ...b]);
    model.select(keyA);
    model.setEvents([...b]);
    expect(model.selectedKey).toBeNull();
    expect(model.selectedEventId).toBeNull();
  });

  test('keeps a selection still in the buffer', () => {
    const model = modelWith([...a]);
    model.select(keyA);
    model.setEvents([...a, ...b]);
    expect(model.selectedKey).toBe(keyA);
    expect(model.selectedSpan?.key).toBe(keyA);
  });

  test('leaves Raw-mode keys to the list', () => {
    const model = modelWith([...a]);
    model.select('raw:0');
    model.setEvents([...b]);
    expect(model.selectedKey).toBe('raw:0');
    expect(model.selectedSpan).toBeUndefined();
  });

  test('drops an element filter after Clear', () => {
    const model = modelWith([...a, ...b]);
    model.setFilter({elementId: 2, regex: 'update'});
    model.setEvents([]);
    expect(model.filter).toEqual({
      elementId: null,
      regex: 'update',
      range: null,
    });
  });

  test('keeps an element filter whose element is still recorded', () => {
    const model = modelWith([...a, ...b]);
    model.setFilter({elementId: 2});
    model.setEvents([...b]);
    expect(model.filter.elementId).toBe(2);
  });
});

describe('TimelineModel deep links', () => {
  test('a link into a loaded buffer resolves at once', () => {
    const model = modelWith([...a, ...b]);
    expect(model.selectEvent('1-update-start')).toBe(true);
    expect(model.selectedKey).toBe(keyA);
  });

  test('a link to an evicted event clears the selection', () => {
    const model = modelWith([...a, ...b]);
    model.select(keyA);
    expect(model.selectEvent('gone')).toBe(false);
    expect(model.selectedKey).toBeNull();
    expect(model.selectedEventId).toBeNull();
  });

  test("reports the span's start event even when linked by its end", () => {
    const model = modelWith([...a, ...b]);
    model.selectEvent('2-update-end');
    expect(model.selectedKey).toBe(keyB);
    expect(model.selectedEventId).toBe('2-update-start');
  });
});

describe('raw rows', () => {
  test('rawRow keys are recognised as raw', () => {
    const row = rawRow(a[0]!, 3);
    expect(row.key).toBe('raw:3');
    expect(isRawKey(row.key)).toBe(true);
    expect(isRawKey(keyA)).toBe(false);
    expect(row.groupId).toBeUndefined();
  });
});

describe('summarizeUpdates', () => {
  test('rolls up the attributed cycles', () => {
    const {cycles, components} = summarizeUpdates(
      pair('performUpdate', 0, 1, 'x-a')
    );
    expect(cycles).toHaveLength(1);
    expect(components.map((c) => c.tagName)).toEqual(['x-a']);
  });
});
