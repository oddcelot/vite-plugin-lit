import {describe, expect, test} from 'vite-plus/test';
import {toSpans} from '../../lib/timeline/derive.js';
import type {TimelineSpan} from '../../lib/timeline/derive.js';
import {
  MAX_ZOOM,
  buildTracks,
  clampPan,
  livePan,
  niceStep,
  timeBounds,
  timeScale,
  visibleRange,
  zoomAt,
} from '../../lib/timeline/tracks.js';
import type {TimelineEvent} from '../../types/timeline.js';

/** One lifecycle phase boundary, shaped like `runtime/timeline/lifecycle.ts`
 *  emits it (see `timeline-derive_test.ts` for the full story). */
const phase = (
  name: string,
  edge: 'start' | 'end',
  time: number,
  tickId = '1:1'
): TimelineEvent => ({
  layerId: 'lit-lifecycle',
  time,
  groupId: tickId,
  title: `${name}:${edge}`,
  data: {phase: name},
});

/** A complete update tick: performUpdate brackets the phases it nests. */
const tick = (start: number, tickId = '1:1'): TimelineEvent[] => [
  phase('performUpdate', 'start', start, tickId),
  phase('willUpdate', 'start', start + 1, tickId),
  phase('willUpdate', 'end', start + 1.5, tickId),
  phase('update', 'start', start + 2, tickId),
  phase('update', 'end', start + 3, tickId),
  phase('performUpdate', 'end', start + 4, tickId),
];

const point = (layerId: string, time: number): TimelineEvent => ({
  layerId,
  time,
  title: 'click',
  data: null,
});

const LAYERS = [{id: 'lit-lifecycle'}, {id: 'lit-render'}, {id: 'mouse'}];

const names = (row: readonly TimelineSpan[]) => row.map((s) => s.name);

describe('buildTracks', () => {
  test('gives every layer a track, in layer order, even when empty', () => {
    const tracks = buildTracks(toSpans([point('mouse', 1)]), LAYERS);
    expect(tracks.map((t) => t.layerId)).toEqual([
      'lit-lifecycle',
      'lit-render',
      'mouse',
    ]);
    expect(tracks[0]!.rows).toEqual([]);
    expect(tracks[2]!.rows.length).toBe(1);
  });

  test('appends layers the spans mention but the layer list does not', () => {
    const tracks = buildTracks(
      toSpans([point('router', 1), point('mouse', 2), point('store', 3)]),
      LAYERS
    );
    expect(tracks.map((t) => t.layerId)).toEqual([
      'lit-lifecycle',
      'lit-render',
      'mouse',
      'router',
      'store',
    ]);
  });

  test('nests the phases of one tick under their performUpdate', () => {
    const [lifecycle] = buildTracks(toSpans(tick(10)), LAYERS);
    expect(lifecycle!.rows.map(names)).toEqual([
      ['performUpdate'],
      ['willUpdate', 'update'],
    ]);
  });

  test('reuses row 0 for the next tick once the previous one has ended', () => {
    const [lifecycle] = buildTracks(
      toSpans([...tick(0, '1:1'), ...tick(10, '1:2')]),
      LAYERS
    );
    expect(lifecycle!.rows.map(names)).toEqual([
      ['performUpdate', 'performUpdate'],
      ['willUpdate', 'update', 'willUpdate', 'update'],
    ]);
  });

  test('keeps point events at the same instant on one row', () => {
    const tracks = buildTracks(
      toSpans([point('mouse', 5), point('mouse', 5), point('mouse', 6)]),
      LAYERS
    );
    expect(tracks[2]!.rows.length).toBe(1);
    expect(tracks[2]!.rows[0]!.length).toBe(3);
  });

  test('keeps an open span on its row for the rest of the recording', () => {
    // performUpdate never ended, so it is drawn to the live edge; the next
    // tick cannot share its row.
    const [lifecycle] = buildTracks(
      toSpans([phase('performUpdate', 'start', 0, '1:1'), ...tick(10, '1:2')]),
      LAYERS
    );
    expect(lifecycle!.rows.map(names)).toEqual([
      ['performUpdate'],
      ['performUpdate'],
      ['willUpdate', 'update'],
    ]);
  });

  test('sorts spans a caller passes out of order', () => {
    const [, , mouse] = buildTracks(
      toSpans([point('mouse', 1), point('mouse', 3)]).reverse(),
      LAYERS
    );
    expect(mouse!.rows[0]!.map((s) => s.start)).toEqual([1, 3]);
  });
});

describe('timeBounds', () => {
  test('starts at the earliest span and ends at the latest instant', () => {
    expect(timeBounds(toSpans([point('mouse', 40), ...tick(50)]))).toEqual({
      origin: 40,
      extent: 14,
    });
  });

  test('is empty with no spans', () => {
    expect(timeBounds([])).toEqual({origin: 0, extent: 0});
  });
});

describe('timeScale', () => {
  test('fits the whole recording at zoom 1', () => {
    const scale = timeScale(100, 50, 500);
    expect(scale.pxPerMs).toBe(10);
    expect(scale.start).toBe(100);
    expect(scale.end).toBe(150);
    expect(scale.toX(100)).toBe(0);
    expect(scale.toX(150)).toBe(500);
    expect(scale.toMs(250)).toBe(125);
  });

  test('zooms and pans from the origin', () => {
    const scale = timeScale(100, 50, 500, 2, 10);
    expect(scale.pxPerMs).toBe(20);
    expect(scale.start).toBe(110);
    expect(scale.end).toBe(135);
  });

  test('clamps zoom to fit and pan to the recording', () => {
    const out = timeScale(0, 50, 500, 0.1, -20);
    expect(out.start).toBe(0);
    expect(out.end).toBe(50);
    const past = timeScale(0, 50, 500, 2, 1000);
    expect(past.end).toBe(50);
    expect(timeScale(0, 50, 500, Infinity).pxPerMs).toBe((500 / 50) * MAX_ZOOM);
  });

  test('gives a single-instant recording a nonzero axis', () => {
    const scale = timeScale(7, 0, 100);
    expect(Number.isFinite(scale.pxPerMs)).toBe(true);
    expect(scale.toX(7)).toBe(0);
  });
});

describe('pan and zoom helpers', () => {
  test('clampPan and livePan keep the window inside the recording', () => {
    expect(clampPan(-5, 100, 4)).toBe(0);
    expect(clampPan(500, 100, 4)).toBe(75);
    expect(livePan(100, 4)).toBe(75);
    expect(livePan(100, 1)).toBe(0);
  });

  test('zoomAt keeps the millisecond under the cursor in place', () => {
    const before = timeScale(0, 100, 1000, 1, 0);
    const anchor = before.toMs(250);
    const next = zoomAt(0, 100, 1000, 1, 0, 250, 4);
    expect(next.zoom).toBe(4);
    const after = timeScale(0, 100, 1000, next.zoom, next.pan);
    expect(after.toX(anchor)).toBeCloseTo(250);
  });
});

describe('visibleRange', () => {
  const row = toSpans([
    phase('update', 'start', 0),
    phase('update', 'end', 5),
    point('lit-lifecycle', 10),
    point('lit-lifecycle', 20),
    point('lit-lifecycle', 30),
  ]);

  test('includes a span that starts before the window but reaches into it', () => {
    expect(visibleRange(row, 3, 12)).toEqual([0, 2]);
  });

  test('excludes spans wholly outside the window', () => {
    expect(visibleRange(row, 15, 25)).toEqual([2, 3]);
    expect(visibleRange(row, 31, 40)).toEqual([4, 4]);
  });

  test('includes a point exactly on the window edge', () => {
    expect(visibleRange(row, 20, 20)).toEqual([2, 3]);
  });
});

describe('niceStep', () => {
  test('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(0.3)).toBeCloseTo(0.5);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(13)).toBe(20);
    expect(niceStep(4200)).toBe(5000);
    expect(niceStep(0)).toBe(1);
  });
});
