import {describe, expect, test} from 'vite-plus/test';
import {toSpans} from '../../lib/timeline/derive.js';
import {applyFilter, NO_FILTER} from '../../lib/timeline/model.js';
import {buildListRows, tickParentKey} from '../../lib/timeline/tick-rows.js';
import type {TimelineEvent} from '../../types/timeline.js';

const phase = (
  name: string,
  time: number,
  elementId = 1,
  tick = 1
): TimelineEvent[] =>
  (['start', 'end'] as const).map((edge, i) => ({
    id: `${elementId}-${tick}-${name}-${edge}`,
    layerId: 'lit-lifecycle',
    time: time + i,
    groupId: `${elementId}:${tick}`,
    title: `${name}:${edge}`,
    data: {},
    meta: {elementId, tagName: `x-${elementId}`},
  }));

const point = (
  layerId: string,
  title: string,
  time: number,
  extra: Partial<TimelineEvent> = {}
): TimelineEvent => ({
  id: `${layerId}-${title}-${time}`,
  layerId,
  time,
  data: {},
  title,
  meta: {elementId: 1, tagName: 'x-1'},
  ...extra,
});

const tick = (elementId: number, t: number, n = 1) => [
  ...phase('performUpdate', t, elementId, n),
  ...phase('willUpdate', t + 0.1, elementId, n),
  ...phase('update', t + 0.2, elementId, n),
  ...phase('updated', t + 0.3, elementId, n),
];

const rowsOf = (
  events: TimelineEvent[],
  expanded: string[] = [],
  filter = NO_FILTER
) => {
  const spans = toSpans(events);
  return buildListRows(spans, applyFilter(spans, filter), new Set(expanded));
};
const names = (rows: ReturnType<typeof rowsOf>) =>
  rows.map((r) => `${r.depth}:${r.span.name}`);
const ROOT = 'lit-lifecycle:1:1:performUpdate';

describe('buildListRows', () => {
  test('collapses a tick to its performUpdate row with a nested count', () => {
    const rows = rowsOf(tick(1, 0));
    expect(names(rows)).toEqual(['0:performUpdate']);
    expect(rows[0]!.tick).toEqual({expanded: false, count: 3});
  });

  test('expanding lists the phases after their parent', () => {
    const rows = rowsOf([...tick(1, 0), ...tick(2, 5)], [ROOT]);
    expect(names(rows)).toEqual([
      '0:performUpdate',
      '1:willUpdate',
      '1:update',
      '1:updated',
      '0:performUpdate',
    ]);
    expect(rows[0]!.tick?.expanded).toBe(true);
    expect(rows[4]!.tick?.expanded).toBe(false);
  });

  test('nests skips, warnings and in-update custom events; flags the worst', () => {
    const events = [
      ...tick(1, 0),
      point('lit-lifecycle', 'update skipped', 0.5, {groupId: '1:1'}),
      point('lit-lifecycle', 'dev warning', 0.6, {
        groupId: '1:1',
        logType: 'warning',
      }),
      point('custom-events', 'change', 0.7, {groupId: '1:1'}),
      point('custom-events', 'later', 9),
    ];
    const rows = rowsOf(events);
    expect(names(rows)).toEqual(['0:performUpdate', '0:later']);
    expect(rows[0]!.tick).toEqual({
      expanded: false,
      count: 6,
      attention: 'warning',
    });
  });

  test('a late async error flags the tick as an error', () => {
    const events = [
      ...tick(1, 0),
      point('lit-lifecycle', 'updated:rejected', 9, {
        groupId: '1:1',
        logType: 'error',
        data: {error: {name: 'Error', message: 'x'}, async: true},
      }),
    ];
    expect(rowsOf(events)[0]!.tick?.attention).toBe('error');
  });

  test('rows outside a tick, and other layers sharing an id, stay top-level', () => {
    const events = [
      point('mouse', 'click', 0, {groupId: '1:1'}),
      ...tick(1, 1),
      point('lit-lifecycle', 'connected', 3),
    ];
    expect(names(rowsOf(events))).toEqual([
      '0:click',
      '0:performUpdate',
      '0:connected',
    ]);
  });

  test('a phase whose performUpdate is gone stays top-level', () => {
    const events = [...phase('updated', 0)];
    expect(names(rowsOf(events))).toEqual(['0:updated']);
  });

  test('a tick with nothing nested is a plain row', () => {
    const rows = rowsOf(phase('performUpdate', 0));
    expect(rows[0]!.tick).toBeUndefined();
  });

  test('the element filter keeps or drops a whole tick', () => {
    const events = [...tick(1, 0), ...tick(2, 5)];
    const rows = rowsOf(events, [], {...NO_FILTER, elementId: 2});
    expect(names(rows)).toEqual(['0:performUpdate']);
    expect(rows[0]!.span.meta?.elementId).toBe(2);
  });

  test('a regex matching only a child keeps the parent and that child', () => {
    const filter = {...NO_FILTER, regex: 'updated'};
    const events = [...tick(1, 0), ...phase('other', 20)];
    const rows = rowsOf(events, [ROOT], filter);
    expect(names(rows)).toEqual(['0:performUpdate', '1:updated']);
    expect(rows[0]!.tick?.count).toBe(1);
  });

  test('a regex matching the parent keeps all of its children', () => {
    const filter = {...NO_FILTER, regex: 'performUpdate'};
    const rows = rowsOf(tick(1, 0), [ROOT], filter);
    expect(names(rows)).toHaveLength(4);
  });

  test('a range that holds only a child still shows its parent', () => {
    const filter = {...NO_FILTER, range: {start: 0.25, end: 1}};
    const rows = rowsOf(tick(1, 0), [ROOT], filter);
    expect(names(rows)).toEqual(['0:performUpdate', '1:updated']);
  });
});

describe('tickParentKey', () => {
  test('names the performUpdate a nested span belongs to', () => {
    const spans = toSpans(tick(1, 0));
    const updated = spans.find((s) => s.name === 'updated')!;
    expect(tickParentKey(updated, spans)).toBe(ROOT);
    expect(
      tickParentKey(
        spans.find((s) => s.name === 'performUpdate')!,
        spans
      )
    ).toBeUndefined();
  });
});
