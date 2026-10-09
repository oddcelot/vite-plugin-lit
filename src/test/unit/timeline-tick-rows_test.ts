import {describe, expect, test} from 'vite-plus/test';
import {toSpans} from '../../lib/timeline/derive.js';
import {applyFilter, NO_FILTER} from '../../lib/timeline/model.js';
import {
  buildListRows,
  tickAncestorKeys,
  tickParentKey,
} from '../../lib/timeline/tick-rows.js';
import type {TimelineCause, TimelineEvent} from '../../types/timeline.js';

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

/** A tick whose `performUpdate:start` carries the recorded cause. */
const causedTick = (
  elementId: number,
  t: number,
  n: number,
  cause: TimelineCause
): TimelineEvent[] => {
  const events = tick(elementId, t, n);
  events[0] = {...events[0]!, cause};
  return events;
};

const PARENT = 'lit-lifecycle:1:1:performUpdate';
const CHILD = 'lit-lifecycle:2:1:performUpdate';
const GRAND = 'lit-lifecycle:3:1:performUpdate';

describe('cause nesting', () => {
  const chain = [
    ...tick(1, 0),
    ...causedTick(2, 1, 1, {kind: 'update', groupId: '1:1'}),
    ...causedTick(3, 2, 1, {kind: 'update', groupId: '2:1'}),
  ];

  test('a tick caused by another tick nests under it', () => {
    const collapsed = rowsOf(chain);
    expect(names(collapsed)).toEqual(['0:performUpdate']);
    // Direct children only: its three phases and the child tick.
    expect(collapsed[0]!.tick).toEqual({expanded: false, count: 4});

    const rows = rowsOf(chain, [PARENT]);
    expect(names(rows)).toEqual([
      '0:performUpdate',
      '1:willUpdate',
      '1:update',
      '1:updated',
      '1:performUpdate',
    ]);
    expect(rows[4]!.tick).toEqual({expanded: false, count: 4});
  });

  test('an expanded child lists its phases and grandchild at depth 2', () => {
    const rows = rowsOf(chain, [PARENT, CHILD]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(rows[4]!.tick?.expanded).toBe(true);
    expect(rows[8]!.span.key).toBe(GRAND);
  });

  test('descendants are hidden unless every ancestor is expanded', () => {
    expect(names(rowsOf(chain, [CHILD]))).toEqual(['0:performUpdate']);
  });

  test('a tick caused by an event nests under that event row', () => {
    const events = [
      point('mouse', 'click', 5, {meta: undefined}),
      ...causedTick(1, 6, 1, {kind: 'event', layerId: 'mouse', time: 5}),
    ];
    const collapsed = rowsOf(events);
    expect(names(collapsed)).toEqual(['0:click']);
    expect(collapsed[0]!.tick).toEqual({expanded: false, count: 1});

    const rows = rowsOf(events, ['mouse:point:0']);
    expect(names(rows)).toEqual(['0:click', '1:performUpdate']);
  });

  test('an event cause needs the same layer and time', () => {
    const events = [
      point('keyboard', 'keydown', 5),
      point('mouse', 'click', 7),
      ...causedTick(1, 6, 1, {kind: 'event', layerId: 'mouse', time: 5}),
    ];
    expect(names(rowsOf(events))).toEqual([
      '0:keydown',
      '0:performUpdate',
      '0:click',
    ]);
  });

  test('a tick whose cause was evicted stays top-level', () => {
    const events = [
      ...causedTick(2, 1, 1, {kind: 'update', groupId: '1:1'}),
      ...causedTick(3, 2, 1, {kind: 'event', layerId: 'mouse', time: 0}),
    ];
    expect(names(rowsOf(events))).toEqual([
      '0:performUpdate',
      '0:performUpdate',
    ]);
  });

  test('a cause loop does not lose rows', () => {
    const events = [
      ...causedTick(1, 0, 1, {kind: 'update', groupId: '2:1'}),
      ...causedTick(2, 1, 1, {kind: 'update', groupId: '1:1'}),
      ...causedTick(3, 2, 1, {kind: 'update', groupId: '3:1'}),
    ];
    const keys = rowsOf(events, [PARENT, CHILD, GRAND])
      .filter((r) => r.span.name === 'performUpdate')
      .map((r) => r.span.key);
    expect([...keys].sort()).toEqual([PARENT, CHILD, GRAND]);
  });

  test('a filter matching only a grandchild shows its ancestors', () => {
    const spans = toSpans(chain);
    const match = spans.filter(
      (s) => s.name === 'updated' && s.meta?.elementId === 3
    );
    const rows = buildListRows(spans, match, new Set([PARENT, CHILD, GRAND]));
    expect(names(rows)).toEqual([
      '0:performUpdate',
      '1:performUpdate',
      '2:performUpdate',
      '3:updated',
    ]);
    expect(rows[0]!.tick?.count).toBe(1);
    expect(rows[1]!.tick?.count).toBe(1);
  });

  test('count is direct children; attention covers every shown descendant', () => {
    const events = [
      ...chain,
      point('lit-lifecycle', 'dev warning', 2.5, {
        groupId: '3:1',
        logType: 'warning',
      }),
    ];
    const [top] = rowsOf(events);
    expect(top!.tick).toEqual({
      expanded: false,
      count: 4,
      attention: 'warning',
    });
    const rows = rowsOf(events, [PARENT]);
    expect(rows[4]!.tick).toEqual({
      expanded: false,
      count: 4,
      attention: 'warning',
    });
  });
});

describe('tickAncestorKeys', () => {
  test('lists parents nearest first, empty at top level', () => {
    const spans = toSpans([
      point('mouse', 'click', 0),
      ...causedTick(1, 1, 1, {kind: 'event', layerId: 'mouse', time: 0}),
      ...causedTick(2, 2, 1, {kind: 'update', groupId: '1:1'}),
    ]);
    const updated = spans.find(
      (s) => s.name === 'updated' && s.meta?.elementId === 2
    )!;
    expect(tickAncestorKeys(updated, spans)).toEqual([
      CHILD,
      PARENT,
      'mouse:point:0',
    ]);
    expect(tickAncestorKeys(spans[0]!, spans)).toEqual([]);
    expect(tickParentKey(updated, spans)).toBe(CHILD);
  });
});
