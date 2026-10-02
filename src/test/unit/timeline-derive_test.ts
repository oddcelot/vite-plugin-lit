import {describe, expect, test} from 'vite-plus/test';
import {
  attributeInput,
  rollup,
  toSpans,
  toUpdateCycles,
} from '../../lib/timeline/derive.js';
import type {ChangedValue, TimelineEvent} from '../../types/timeline.js';

/**
 * Builds one lifecycle phase-boundary event exactly as
 * `runtime/timeline/lifecycle.ts` emits it: the whole tick shares one
 * `${elementId}:${tick}` groupId, and only the phases that receive a
 * `PropertyValues` argument carry `changed`.
 */
const phase = (
  name: string,
  edge: 'start' | 'end',
  time: number,
  options: {
    elementId?: number;
    tag?: string;
    tick?: number;
    changed?: string[];
    /** Carried by the `update` start event only, as the runtime does. */
    changedDetail?: ChangedValue[];
    error?: {name: string; message: string};
  } = {}
): TimelineEvent => {
  const elementId = options.elementId ?? 1;
  const tag = options.tag ?? 'hmr-counter';
  // As the runtime does: only the end event of a phase that threw carries it.
  const error = edge === 'end' ? options.error : undefined;
  return {
    layerId: 'lit-lifecycle',
    time,
    groupId: `${elementId}:${options.tick ?? 1}`,
    title: `${name}:${edge}`,
    subtitle: tag,
    ...(error === undefined ? {} : {logType: 'error' as const}),
    data:
      edge === 'start' && options.changed !== undefined
        ? options.changedDetail !== undefined && name === 'update'
          ? {
              phase: name,
              changed: options.changed,
              changedDetail: options.changedDetail,
            }
          : {phase: name, changed: options.changed}
        : error === undefined
          ? {phase: name}
          : {phase: name, error},
    meta: {
      elementId,
      tagName: tag,
      source: {file: '/src/counter.ts', line: 12},
    },
  };
};

/** A complete update tick: performUpdate brackets the phases it nests. */
const tick = (
  start: number,
  options: {
    elementId?: number;
    tag?: string;
    tick?: number;
    changed?: string[];
    changedDetail?: ChangedValue[];
    duration?: number;
    /** Thrown from `update`, so both it and `performUpdate` end in error. */
    error?: {name: string; message: string};
  } = {}
): TimelineEvent[] => {
  const duration = options.duration ?? 4;
  const {error: _error, ...rest} = options;
  return [
    phase('performUpdate', 'start', start, rest),
    phase('willUpdate', 'start', start + 1, rest),
    phase('willUpdate', 'end', start + 1.5, rest),
    phase('update', 'start', start + 2, rest),
    phase('update', 'end', start + 3, options),
    phase('performUpdate', 'end', start + duration, options),
  ];
};

describe('toSpans', () => {
  test('collapses a complete tick into spans with durations', () => {
    const spans = toSpans(tick(100, {changed: ['count']}));
    expect(spans.map((s) => s.name)).toEqual([
      'performUpdate',
      'willUpdate',
      'update',
    ]);
    const byName = new Map(spans.map((s) => [s.name, s]));
    expect(byName.get('performUpdate')!.duration).toBe(4);
    expect(byName.get('willUpdate')!.duration).toBe(0.5);
    expect(byName.get('update')!.duration).toBe(1);
    // Each span keeps both of the events it was built from.
    expect(byName.get('update')!.events.length).toBe(2);
  });

  test('does not cross-pair phases that share a groupId', () => {
    // The regression this whole keying scheme exists for: every phase of one
    // tick carries the same groupId, so pairing on the id alone would marry
    // `willUpdate:start` to `performUpdate:end` and report a 4ms willUpdate.
    const spans = toSpans(tick(0, {duration: 40}));
    const willUpdate = spans.find((s) => s.name === 'willUpdate')!;
    expect(willUpdate.duration).toBe(0.5);
    expect(spans.find((s) => s.name === 'performUpdate')!.duration).toBe(40);
  });

  test('keeps an unfinished span open rather than inventing an end', () => {
    const spans = toSpans([
      phase('performUpdate', 'start', 10),
      phase('willUpdate', 'start', 11),
    ]);
    expect(spans.length).toBe(2);
    for (const span of spans) {
      expect(span.end).toBeUndefined();
      expect(span.duration).toBeUndefined();
    }
  });

  test('keeps an end whose start was evicted from the buffer', () => {
    // The oldest events fall out of a bounded ring, so a trailing `:end` with
    // no partner is routine — dropping it would silently lose the event.
    const spans = toSpans([phase('update', 'end', 5)]);
    expect(spans.length).toBe(1);
    expect(spans[0]!.duration).toBeUndefined();
  });

  test('reports no duration across a clock reset', () => {
    // Recording restarted between the two halves: the runtime re-zeroed its
    // clock, so the end reads as *earlier* than the start.
    const spans = toSpans([
      phase('performUpdate', 'start', 9000),
      phase('performUpdate', 'end', 3),
    ]);
    expect(spans[0]!.duration).toBeUndefined();
    expect(spans[0]!.end).toBeUndefined();
  });

  test('passes point events and unknown custom layers through', () => {
    const spans = toSpans([
      {
        layerId: 'lit-lifecycle',
        time: 1,
        title: 'connectedCallback',
        data: {phase: 'connectedCallback'},
        meta: {elementId: 1, tagName: 'hmr-counter'},
      },
      {layerId: 'mouse', time: 2, title: 'click', subtitle: '(4, 8)', data: {}},
      {layerId: 'my-custom-layer', time: 3, title: 'fetched', data: {}},
    ]);
    expect(spans.map((s) => s.name)).toEqual([
      'connectedCallback',
      'click',
      'fetched',
    ]);
    for (const span of spans) {
      expect(span.duration).toBeUndefined();
    }
    // Distinct keys, so a `repeat()` over them does not collide.
    expect(new Set(spans.map((s) => s.key)).size).toBe(3);
  });

  test('sorts spans by start time', () => {
    const spans = toSpans([
      ...tick(500, {tick: 2}),
      ...tick(100, {tick: 1, elementId: 2}),
    ]);
    const starts = spans.map((s) => s.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('thrown errors', () => {
  const boom = {name: 'TypeError', message: 'render exploded'};

  test('toSpans lifts the end event error onto the span', () => {
    const spans = toSpans(tick(0, {error: boom}));
    const byName = new Map(spans.map((s) => [s.name, s]));
    expect(byName.get('update')!.logType).toBe('error');
    expect(byName.get('update')!.error).toEqual(boom);
    expect(byName.get('willUpdate')!.error).toBeUndefined();
    expect(toSpans(tick(0)).every((s) => s.error === undefined)).toBe(true);
  });

  test('toUpdateCycles reports the innermost phase that threw', () => {
    const [cycle] = toUpdateCycles(toSpans(tick(0, {error: boom})));
    expect(cycle!.error).toEqual({phase: 'update', ...boom});
  });

  test('rollup counts the cycles that threw', () => {
    const entries = rollup(
      toUpdateCycles(
        toSpans([...tick(0, {tick: 1}), ...tick(10, {tick: 2, error: boom})])
      )
    );
    expect(entries[0]!.updates).toBe(2);
    expect(entries[0]!.errors).toBe(1);
  });

  const late = (
    data: Record<string, unknown>,
    options: {tick?: number; title?: string} = {}
  ): TimelineEvent => ({
    layerId: 'lit-lifecycle',
    time: 50,
    groupId: `1:${options.tick ?? 1}`,
    title: options.title ?? 'updated:rejected',
    subtitle: 'hmr-counter',
    data,
    logType: 'error',
    meta: {elementId: 1, tagName: 'hmr-counter'},
  });
  const rejected = late({phase: 'updated', error: boom, async: true});

  test('an async error joins its cycle without becoming a phase', () => {
    const [cycle] = toUpdateCycles(toSpans([...tick(0), rejected]));
    expect(cycle!.error).toEqual({phase: 'updated', ...boom, async: true});
    expect(cycle!.phases.map((p) => p.name)).toEqual([
      'performUpdate',
      'willUpdate',
      'update',
    ]);
  });

  test('a failed task is named on the cycle error', () => {
    const task = late(
      {phase: 'task', task: 'userTask', error: boom, async: true},
      {title: 'task:error'}
    );
    const [cycle] = toUpdateCycles(toSpans([...tick(0), task]));
    expect(cycle!.error).toEqual({
      phase: 'task',
      ...boom,
      async: true,
      task: 'userTask',
    });
  });

  test('an async error does not replace a synchronous one', () => {
    const [cycle] = toUpdateCycles(
      toSpans([...tick(0, {error: boom}), rejected])
    );
    expect(cycle!.error).toEqual({phase: 'update', ...boom});
  });

  test('an async error for a cycle outside the window is skipped', () => {
    const cycles = toUpdateCycles(
      toSpans([
        ...tick(0),
        late(rejected.data as Record<string, unknown>, {tick: 9}),
      ])
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.error).toBeUndefined();
  });

  test('rollup counts a cycle with an async error', () => {
    const entries = rollup(toUpdateCycles(toSpans([...tick(0), rejected])));
    expect(entries[0]!.errors).toBe(1);
  });
});

describe('toUpdateCycles', () => {
  test('groups a tick and takes its duration from performUpdate', () => {
    const cycles = toUpdateCycles(
      toSpans(tick(100, {changed: ['count'], duration: 4}))
    );
    expect(cycles.length).toBe(1);
    const cycle = cycles[0]!;
    expect(cycle.key).toBe('1:1');
    expect(cycle.elementId).toBe(1);
    expect(cycle.tagName).toBe('hmr-counter');
    expect(cycle.start).toBe(100);
    // Not 5.5 — the nested phases run *inside* performUpdate, so summing them
    // would count the same milliseconds three times.
    expect(cycle.duration).toBe(4);
    expect(cycle.phases.length).toBe(3);
    expect(cycle.source).toEqual({file: '/src/counter.ts', line: 12});
  });

  test('unions the changed keys across the phases of one tick', () => {
    // `performUpdate` takes no PropertyValues argument, so the bracketing
    // span never carries the reason; the nested phases do.
    const cycles = toUpdateCycles(
      toSpans(tick(0, {changed: ['count', 'label']}))
    );
    expect(cycles[0]!.changed).toEqual(['count', 'label']);
  });

  test('separates ticks of the same element and ignores non-update events', () => {
    const cycles = toUpdateCycles(
      toSpans([
        {
          layerId: 'lit-lifecycle',
          time: 0,
          title: 'connectedCallback',
          data: {},
          meta: {elementId: 1, tagName: 'hmr-counter'},
        },
        ...tick(10, {tick: 1}),
        ...tick(30, {tick: 2}),
        {layerId: 'mouse', time: 40, title: 'click', data: {}},
      ])
    );
    expect(cycles.map((c) => c.key)).toEqual(['1:1', '1:2']);
  });
});

describe('rollup', () => {
  test('counts updates per component and ranks the reasons', () => {
    const events = [
      ...tick(0, {tick: 1, changed: ['count'], duration: 3}),
      ...tick(50, {tick: 2, changed: ['count'], duration: 5}),
      ...tick(100, {tick: 3, changed: ['label'], duration: 1}),
      ...tick(150, {elementId: 2, tick: 1, changed: ['count'], duration: 2}),
      ...tick(200, {elementId: 9, tag: 'hmr-clock', tick: 1, duration: 40}),
    ];
    const entries = rollup(toUpdateCycles(toSpans(events)));

    // Slowest component first — the one worth looking at.
    expect(entries.map((e) => e.tagName)).toEqual(['hmr-clock', 'hmr-counter']);

    const counter = entries.find((e) => e.tagName === 'hmr-counter')!;
    expect(counter.updates).toBe(4);
    expect(counter.elementIds).toEqual([1, 2]);
    expect(counter.totalMs).toBe(11);
    expect(counter.maxMs).toBe(5);
    expect(counter.reasons).toEqual([
      {key: 'count', count: 3},
      {key: 'label', count: 1},
    ]);
  });

  test('counts a cycle with no measured duration but adds no time', () => {
    const cycles = toUpdateCycles(
      toSpans([phase('performUpdate', 'start', 0)])
    );
    const entries = rollup(cycles);
    expect(entries[0]!.updates).toBe(1);
    expect(entries[0]!.totalMs).toBe(0);
    expect(entries[0]!.maxMs).toBe(0);
  });
});

describe('attributeInput', () => {
  const click = (time: number): TimelineEvent => ({
    layerId: 'mouse',
    time,
    title: 'click',
    subtitle: '(412, 88)',
    data: {},
  });

  test('attributes an update to the input just before it', () => {
    const events = [click(95), ...tick(100)];
    const cycles = attributeInput(toUpdateCycles(toSpans(events)), events);
    expect(cycles[0]!.cause).toEqual({
      layerId: 'mouse',
      type: 'click',
      detail: '(412, 88)',
      time: 95,
    });
  });

  test('leaves an update outside the window uncaused', () => {
    // A timer-driven re-render half a second after the last click is not that
    // click's fault, and claiming it is would be worse than saying nothing.
    const events = [click(0), ...tick(500)];
    const cycles = attributeInput(toUpdateCycles(toSpans(events)), events);
    expect(cycles[0]!.cause).toBeUndefined();
  });

  test('never attributes an update to a later input', () => {
    const events = [...tick(100), click(400)];
    const cycles = attributeInput(toUpdateCycles(toSpans(events)), events);
    expect(cycles[0]!.cause).toBeUndefined();
  });

  test('picks the nearest preceding input across many cycles', () => {
    const events = [
      click(0),
      ...tick(10, {tick: 1}),
      click(1000),
      ...tick(1010, {tick: 2}),
    ];
    const cycles = attributeInput(toUpdateCycles(toSpans(events)), events);
    expect(cycles.map((c) => c.cause?.time)).toEqual([0, 1000]);
  });

  test('returns cycles untouched when nothing was captured', () => {
    const events = tick(10);
    const cycles = attributeInput(toUpdateCycles(toSpans(events)), events);
    expect(cycles[0]!.cause).toBeUndefined();
  });
});

describe('changed value detail', () => {
  const redundant: ChangedValue = {
    key: 'items',
    prev: '[1, 2]',
    next: '[1, 2]',
    sameRef: false,
    equal: true,
  };

  test('a cycle carries the detail, and omits it when absent', () => {
    const [withDetail] = toUpdateCycles(
      toSpans(tick(0, {changed: ['items'], changedDetail: [redundant]}))
    );
    expect(withDetail!.changedDetail).toEqual([redundant]);

    const [without] = toUpdateCycles(toSpans(tick(0, {changed: ['items']})));
    expect(without).not.toHaveProperty('changedDetail');
  });

  test('rollup counts new references holding equal content', () => {
    const events = [
      ...tick(0, {tick: 1, changed: ['items'], changedDetail: [redundant]}),
      ...tick(10, {tick: 2, changed: ['items'], changedDetail: [redundant]}),
    ];
    const [entry] = rollup(toUpdateCycles(toSpans(events)));
    expect(entry!.redundantChanges).toEqual([{key: 'items', count: 2}]);
  });

  test('rollup ignores same-reference and unequal changes', () => {
    const events = [
      ...tick(0, {
        tick: 1,
        changed: ['items'],
        changedDetail: [{...redundant, sameRef: true, equal: false}],
      }),
      ...tick(10, {
        tick: 2,
        changed: ['items'],
        changedDetail: [{...redundant, equal: false}],
      }),
    ];
    const [entry] = rollup(toUpdateCycles(toSpans(events)));
    expect(entry).not.toHaveProperty('redundantChanges');
  });

  test('ignores malformed entries', () => {
    const [event] = tick(0, {changed: ['items'], changedDetail: [redundant]});
    const update = tick(0, {
      changed: ['items'],
      changedDetail: [redundant],
    }).find((e) => e.title === 'update:start')!;
    update.data = {
      phase: 'update',
      changed: ['items'],
      changedDetail: [{key: 'items'}, null, 'x', {...redundant, equal: 'yes'}],
    };
    const spans = toSpans([event!, update]);
    expect(
      spans.find((s) => s.name === 'update')!.changedDetail
    ).toBeUndefined();
  });
});
