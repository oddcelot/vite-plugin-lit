import {describe, expect, test} from 'vite-plus/test';
import {
  buildRails,
  causeParents,
  MAX_LANES,
} from '../../lib/timeline/cause-rails.js';
import type {TimelineSpan} from '../../lib/timeline/derive.js';
import type {ListRow} from '../../lib/timeline/tick-rows.js';
import type {TimelineCause} from '../../types/timeline.js';

/** A `performUpdate` span; `cause` is what scheduled it. */
const tick = (
  groupId: string,
  start: number,
  cause?: TimelineCause
): TimelineSpan => ({
  layerId: 'lit-lifecycle',
  name: 'performUpdate',
  key: `tick:${groupId}`,
  groupId,
  start,
  events: [],
  ...(cause === undefined ? {} : {cause}),
});

/** A point span such as a click: no groupId. */
const point = (layerId: string, name: string, start: number): TimelineSpan => ({
  layerId,
  name,
  key: `${layerId}:${name}:${start}`,
  start,
  events: [],
});

/** A phase folded under a tick. */
const phase = (groupId: string, start: number): TimelineSpan => ({
  layerId: 'lit-lifecycle',
  name: 'updated',
  key: `phase:${groupId}`,
  groupId,
  start,
  events: [],
});

/** A `@lit/task` run's span; `cause` is what started it. */
const taskRun = (
  groupId: string,
  start: number,
  cause?: TimelineCause
): TimelineSpan => ({
  layerId: 'lit-lifecycle',
  name: 'task',
  key: `task:${groupId}`,
  groupId,
  start,
  events: [],
  ...(cause === undefined ? {} : {cause}),
});

const top = (span: TimelineSpan): ListRow => ({span, depth: 0});
const folded = (span: TimelineSpan): ListRow => ({span, depth: 1});
const byTick = (groupId: string): TimelineCause => ({kind: 'update', groupId});
const byEvent = (layerId: string, time: number): TimelineCause => ({
  kind: 'event',
  layerId,
  time,
});

const QUIET = {through: [], above: false, below: false};

describe('buildRails', () => {
  test('rows with no causes draw nothing', () => {
    const rows = [
      top(point('mouse', 'click', 0)),
      top(tick('1:1', 1)),
      folded(phase('1:1', 1.1)),
      top(tick('2:1', 2)),
    ];
    expect(buildRails(rows)).toEqual([QUIET, QUIET, QUIET, QUIET]);
  });

  test('a click -> tick -> tick chain runs in lane 0, then lane 0 is free', () => {
    const click = point('mouse', 'click', 0);
    const parent = tick('1:1', 1, byEvent('mouse', 0));
    const child = tick('2:1', 2, byTick('1:1'));
    const click2 = point('mouse', 'click', 10);
    const next = tick('3:1', 11, byEvent('mouse', 10));
    const rails = buildRails([
      top(click),
      top(parent),
      top(child),
      top(click2),
      top(next),
    ]);
    expect(rails[0]).toEqual({
      lane: 0,
      through: [],
      above: false,
      below: true,
      chain: 0,
    });
    expect(rails[1]).toEqual({
      lane: 0,
      through: [],
      above: true,
      below: true,
      chain: 0,
    });
    expect(rails[2]).toEqual({
      lane: 0,
      through: [],
      above: true,
      below: false,
      chain: 0,
    });
    expect(rails[3]).toEqual({
      lane: 0,
      through: [],
      above: false,
      below: true,
      chain: 1,
    });
    expect(rails[4]).toEqual({
      lane: 0,
      through: [],
      above: true,
      below: false,
      chain: 1,
    });
  });

  test('fan-out: early children fork, the last continues, forked leaves free their lane', () => {
    const parent = tick('1:1', 0, byEvent('mouse', -1));
    const click = point('mouse', 'click', -1);
    const rails = buildRails([
      top(click),
      top(parent),
      top(tick('2:1', 1, byTick('1:1'))),
      top(tick('3:1', 2, byTick('1:1'))),
      top(tick('4:1', 3, byTick('1:1'))),
    ]);
    // click -> parent continues lane 0, then the parent fans out.
    expect(rails[1]).toEqual({
      lane: 0,
      through: [],
      above: true,
      below: true,
      chain: 0,
    });
    // Both forked leaves reuse lane 1, since each frees it after its row.
    for (const i of [2, 3]) {
      expect(rails[i]).toEqual({
        lane: 1,
        fork: 0,
        through: [0],
        above: false,
        below: false,
        chain: 0,
      });
    }
    expect(rails[4]).toEqual({
      lane: 0,
      through: [],
      above: true,
      below: false,
      chain: 0,
    });
  });

  test('click -> tick -> task run -> tick is one lane and one chain', () => {
    const click = point('mouse', 'click', 0);
    const first = tick('1:2', 1, byEvent('mouse', 0));
    const run = taskRun('task:1:1', 1.5, byTick('1:2'));
    const other = tick('9:1', 3);
    const settled = tick('1:3', 40, {kind: 'task', groupId: 'task:1:1'});
    const rows = [top(click), top(first), top(run), top(other), top(settled)];
    const parents = causeParents(rows);
    expect(parents.get(first)).toBe(click);
    expect(parents.get(run)).toBe(first);
    expect(parents.get(settled)).toBe(run);
    const rails = buildRails(rows);
    expect(rails.map((r) => r.lane)).toEqual([0, 0, 0, undefined, 0]);
    expect(rails.map((r) => r.chain)).toEqual([0, 0, 0, undefined, 0]);
    expect(rails[3]).toEqual({through: [0], above: false, below: false});
    expect(rails[4]).toMatchObject({above: true, below: false});
  });

  test('rows between a parent and its child carry the open lane through', () => {
    const parent = tick('1:1', 0, byEvent('mouse', -1));
    const rails = buildRails([
      top(point('mouse', 'click', -1)),
      top(parent),
      folded(phase('1:1', 0.5)),
      top(tick('9:1', 1)),
      top(tick('2:1', 2, byTick('1:1'))),
    ]);
    expect(rails[2]).toEqual({through: [0], above: false, below: false});
    expect(rails[3]).toEqual({through: [0], above: false, below: false});
    expect(rails[4]).toMatchObject({lane: 0, above: true, below: false});
    expect(rails[4]!.through).toEqual([]);
  });

  test('two interleaved chains get different chains and lanes', () => {
    const a1 = tick('1:1', 0);
    const b1 = tick('2:1', 1);
    const a2 = tick('3:1', 2, byTick('1:1'));
    const b2 = tick('4:1', 3, byTick('2:1'));
    const rails = buildRails([top(a1), top(b1), top(a2), top(b2)]);
    expect(rails).toEqual([
      {lane: 0, through: [], above: false, below: true, chain: 0},
      {lane: 1, through: [0], above: false, below: true, chain: 1},
      {lane: 0, through: [1], above: true, below: false, chain: 0},
      {lane: 1, through: [], above: true, below: false, chain: 1},
    ]);
  });

  test('a cause that names a row not on screen leaves a lone row', () => {
    const rails = buildRails([
      top(tick('2:1', 1, byTick('9:1'))),
      top(tick('3:1', 2, byEvent('mouse', 0))),
    ]);
    expect(rails).toEqual([QUIET, QUIET]);
  });

  test('a filtered-out parent makes the child the root of its own chain', () => {
    const child = tick('2:1', 1, byTick('1:1'));
    const grand = tick('3:1', 2, byTick('2:1'));
    const rails = buildRails([top(child), top(grand)]);
    expect(rails[0]).toEqual({
      lane: 0,
      through: [],
      above: false,
      below: true,
      chain: 0,
    });
    expect(rails[1]).toEqual({
      lane: 0,
      through: [],
      above: true,
      below: false,
      chain: 0,
    });
  });

  test('a stale cause, whose parent row comes later, is not linked', () => {
    const rows = [top(tick('2:1', 0, byTick('1:1'))), top(tick('1:1', 1))];
    expect(causeParents(rows).size).toBe(0);
    expect(buildRails(rows)).toEqual([QUIET, QUIET]);
  });

  test(`caps the column at MAX_LANES (${MAX_LANES}) by drawing in the parent's lane`, () => {
    // A parent with 10 children, each with a pending child: 10 forks want to
    // be open at once. Past the cap a child is drawn in its parent's lane
    // with `above: true` and no `fork`, as a straight continuation.
    const root = tick('0:1', 0);
    const kids = Array.from({length: 10}, (_, i) =>
      tick(`k${i}:1`, 1 + i, byTick('0:1'))
    );
    const grands = kids.map((kid, i) =>
      tick(`g${i}:1`, 20 + i, byTick(kid.groupId as string))
    );
    const rows = [root, ...kids, ...grands].map(top);
    const rails = buildRails(rows);

    expect(rails).toHaveLength(rows.length);
    for (const rail of rails) {
      expect(Array.isArray(rail.through)).toBe(true);
      for (const lane of [rail.lane, rail.fork, ...rail.through]) {
        if (lane !== undefined) expect(lane).toBeLessThan(MAX_LANES);
      }
    }
    // Kids 1..7 fork into lanes 1..7.
    kids.slice(0, 7).forEach((_, i) => {
      expect(rails[1 + i]).toMatchObject({lane: 1 + i, fork: 0, above: false});
    });
    // The 8th and 9th have no free lane: parent's lane, no fork.
    for (const i of [7, 8]) {
      expect(rails[1 + i]).toMatchObject({lane: 0, above: true, below: true});
      expect(rails[1 + i]!.fork).toBeUndefined();
    }
    // The last child continues the parent's lane as usual.
    expect(rails[10]).toMatchObject({lane: 0, above: true, below: true});
    expect(rails[10]!.fork).toBeUndefined();
  });
});

describe('causeParents', () => {
  test('maps ticks to the top-level rows that caused them', () => {
    const click = point('mouse', 'click', 0);
    const a = tick('1:1', 1, byEvent('mouse', 0));
    const b = tick('2:1', 2, byTick('1:1'));
    const parents = causeParents([top(click), top(a), top(b)]);
    expect(parents.get(a)).toBe(click);
    expect(parents.get(b)).toBe(a);
    expect(parents.size).toBe(2);
  });

  test('ignores depth-1 rows, as children and as parents', () => {
    const parent = tick('1:1', 0);
    const nestedTick = tick('2:1', 1, byTick('1:1'));
    const nestedClick = point('mouse', 'click', 2);
    const viaNested = tick('3:1', 3, byEvent('mouse', 2));
    const parents = causeParents([
      top(parent),
      folded(nestedTick),
      folded(nestedClick),
      top(viaNested),
      top(tick('4:1', 4, byTick('2:1'))),
    ]);
    expect(parents.size).toBe(0);
  });

  test('ignores a tick that names itself', () => {
    const self = tick('1:1', 0, byTick('1:1'));
    expect(causeParents([top(self)]).size).toBe(0);
    expect(buildRails([top(self)])).toEqual([QUIET]);
  });
});
