import {describe, expect, test} from 'vite-plus/test';
import {toSpans} from '../../lib/timeline/derive.js';
import {applyFilter, NO_FILTER} from '../../lib/timeline/model.js';
import {
  buildListRows,
  causeParentKey,
  foldParentKey,
  foldParentKeys,
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

describe('foldParentKey', () => {
  test('names the performUpdate a folded span belongs to', () => {
    const spans = toSpans(tick(1, 0));
    const updated = spans.find((s) => s.name === 'updated')!;
    expect(foldParentKey(updated, spans)).toBe(ROOT);
    expect(
      foldParentKey(
        spans.find((s) => s.name === 'performUpdate')!,
        spans
      )
    ).toBeUndefined();
  });

  test('is undefined when the tick is not among the spans', () => {
    const spans = toSpans(phase('updated', 0));
    expect(foldParentKey(spans[0]!, spans)).toBeUndefined();
  });

  test('ignores a cause: a caused tick folds under nothing', () => {
    const spans = toSpans([
      ...tick(1, 0),
      ...causedTick(2, 1, 1, {kind: 'update', groupId: '1:1'}),
    ]);
    const child = spans.find((s) => s.key === CHILD)!;
    expect(foldParentKey(child, spans)).toBeUndefined();
  });
});

describe('foldParentKeys', () => {
  test('maps every folded span to its tick, once', () => {
    const spans = toSpans([
      ...tick(1, 0),
      ...tick(2, 5),
      point('mouse', 'x', 9),
    ]);
    const keys = foldParentKeys(spans);
    expect(keys.size).toBe(6);
    expect(keys.get('lit-lifecycle:1:1:updated')).toBe(ROOT);
    expect(keys.get('lit-lifecycle:2:1:willUpdate')).toBe(CHILD);
    expect(keys.has(ROOT)).toBe(false);
  });
});

describe('causeParentKey', () => {
  test('an update cause names the tick with that groupId', () => {
    const spans = toSpans([
      ...tick(1, 0),
      ...causedTick(2, 1, 1, {kind: 'update', groupId: '1:1'}),
    ]);
    expect(
      causeParentKey(
        spans.find((s) => s.key === CHILD)!,
        spans
      )
    ).toBe(PARENT);
  });

  test('an event cause names the point span at that layer and time', () => {
    const spans = toSpans([
      point('keyboard', 'keydown', 5),
      point('mouse', 'click', 5),
      ...causedTick(1, 6, 1, {kind: 'event', layerId: 'mouse', time: 5}),
    ]);
    const click = spans.find((s) => s.name === 'click')!;
    expect(
      causeParentKey(
        spans.find((s) => s.key === PARENT)!,
        spans
      )
    ).toBe(click.key);
  });

  test('is undefined when the target is not among the spans', () => {
    const spans = toSpans([
      ...causedTick(2, 1, 1, {kind: 'update', groupId: '1:1'}),
      ...causedTick(3, 2, 1, {kind: 'event', layerId: 'mouse', time: 0}),
      point('mouse', 'click', 7),
    ]);
    for (const span of spans.filter((s) => s.name === 'performUpdate')) {
      expect(causeParentKey(span, spans)).toBeUndefined();
    }
  });

  test('is undefined for a span that is not a tick', () => {
    const spans = toSpans([
      ...tick(1, 0),
      point('mouse', 'click', 5, {cause: {kind: 'update', groupId: '1:1'}}),
    ]);
    const click = spans.find((s) => s.name === 'click')!;
    expect(causeParentKey(click, spans)).toBeUndefined();
    const updated = spans.find((s) => s.name === 'updated')!;
    expect(causeParentKey(updated, spans)).toBeUndefined();
  });

  test('is undefined for a tick without a cause', () => {
    const spans = toSpans(tick(1, 0));
    expect(causeParentKey(spans[0]!, spans)).toBeUndefined();
  });
});

describe('task runs', () => {
  const taskRun = (
    groupId: string,
    start: number,
    end: number,
    cause?: TimelineCause
  ): TimelineEvent[] => [
    {
      layerId: 'lit-lifecycle',
      time: start,
      groupId,
      title: 'task:start',
      data: {phase: 'task', task: 'userTask'},
      ...(cause === undefined ? {} : {cause}),
      meta: {elementId: 1, tagName: 'x-1'},
    },
    {
      layerId: 'lit-lifecycle',
      time: end,
      groupId,
      title: 'task:end',
      data: {phase: 'task', task: 'userTask', status: 'complete'},
      meta: {elementId: 1, tagName: 'x-1'},
    },
  ];
  const RUN = 'lit-lifecycle:task:1:1:task';

  test('a task span stays top level, even while its tick is expanded', () => {
    const events = [
      ...tick(1, 0),
      ...taskRun('task:1:1', 0.15, 5, {kind: 'update', groupId: '1:1'}),
    ];
    expect(names(rowsOf(events, [ROOT]))).toEqual([
      '0:performUpdate',
      '1:willUpdate',
      '1:update',
      '1:updated',
      '0:task',
    ]);
    expect(foldParentKeys(toSpans(events)).has(RUN)).toBe(false);
  });

  test('a run names the tick that started it, and a tick names the run', () => {
    const spans = toSpans([
      ...tick(1, 0),
      ...taskRun('task:1:1', 0.15, 5, {kind: 'update', groupId: '1:1'}),
      ...causedTick(1, 6, 2, {kind: 'task', groupId: 'task:1:1'}),
    ]);
    const run = spans.find((s) => s.key === RUN)!;
    expect(causeParentKey(run, spans)).toBe(ROOT);
    const next = spans.find(
      (s) => s.name === 'performUpdate' && s.groupId === '1:2'
    )!;
    expect(causeParentKey(next, spans)).toBe(RUN);
  });

  test('a task cause whose run is gone is undefined', () => {
    const spans = toSpans(
      causedTick(1, 6, 2, {kind: 'task', groupId: 'task:1:1'})
    );
    expect(causeParentKey(spans[0]!, spans)).toBeUndefined();
  });
});

describe('caused ticks in the list', () => {
  test('a caused tick stays top-level, in time order, with its phases folded', () => {
    const events = [
      point('mouse', 'click', 0),
      ...tick(1, 1),
      ...causedTick(2, 2, 1, {kind: 'update', groupId: '1:1'}),
      ...causedTick(3, 3, 1, {kind: 'event', layerId: 'mouse', time: 0}),
    ];
    const collapsed = rowsOf(events);
    expect(names(collapsed)).toEqual([
      '0:click',
      '0:performUpdate',
      '0:performUpdate',
      '0:performUpdate',
    ]);
    expect(collapsed[0]!.tick).toBeUndefined();
    expect(collapsed[2]!.tick).toEqual({expanded: false, count: 3});

    const rows = rowsOf(events, [CHILD]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 0, 1, 1, 1, 0]);
    expect(names(rows).slice(2, 6)).toEqual([
      '0:performUpdate',
      '1:willUpdate',
      '1:update',
      '1:updated',
    ]);
  });
});
