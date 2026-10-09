/**
 * Time ranges on the Timeline: the arithmetic of drawing one, and the
 * summary of what happened inside it.
 *
 * A range answers "what was going on between here and here" without reading
 * the list row by row. Pure and framework-free like the rest of
 * `lib/timeline`, so the panel only draws it and a devframe agent tool can
 * summarise a window the same way.
 */

import {rollup, toUpdateCycles} from './derive.js';
import type {ComponentRollup, TimelineSpan} from './derive.js';

/** A window of recording time, in the same milliseconds as span starts. */
export interface TimeRange {
  start: number;
  end: number;
}

/** Narrower than this is a click, not a range. */
const MIN_RANGE_MS = 1e-6;

/**
 * The range between two drag ends in either order, or null when they are the
 * same instant (or not numbers), so a plain click never leaves a hairline.
 */
export const normalizeRange = (a: number, b: number): TimeRange | null => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return end - start < MIN_RANGE_MS ? null : {start, end};
};

/** One end of a {@link TimeRange}. */
export type RangeEdge = 'start' | 'end';

/**
 * `range` with one edge moved to `ms`: kept inside `bounds` and at least
 * `minWidth` from the other edge, so dragging or nudging an edge never
 * flips the range or collapses it into a click (which would clear it).
 */
export const moveEdge = (
  range: TimeRange,
  edge: RangeEdge,
  ms: number,
  bounds: {min: number; max: number},
  minWidth: number
): TimeRange => {
  if (!Number.isFinite(ms)) return range;
  if (edge === 'start') {
    const hi = Math.max(bounds.min, range.end - minWidth);
    return {start: Math.min(Math.max(ms, bounds.min), hi), end: range.end};
  }
  const lo = Math.min(bounds.max, range.start + minWidth);
  return {start: range.start, end: Math.max(Math.min(ms, bounds.max), lo)};
};

/** Link precision: microseconds, which is finer than the panel shows. */
const PARAM_SCALE = 1000;

/**
 * A range as a link carries it, `1.25-3.5` in milliseconds on the buffer's
 * clock. Rounded outward to microseconds so the linked range still covers
 * every span the drawn one did.
 */
export const formatRangeParam = (range: TimeRange): string =>
  `${Math.floor(range.start * PARAM_SCALE) / PARAM_SCALE}-${
    Math.ceil(range.end * PARAM_SCALE) / PARAM_SCALE
  }`;

const RANGE_PARAM = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/;

/** The range a link names, or null for anything but `start-end` numbers. */
export const parseRangeParam = (value: string): TimeRange | null => {
  const match = RANGE_PARAM.exec(value);
  return match ? normalizeRange(Number(match[1]), Number(match[2])) : null;
};

export const sameRange = (a: TimeRange | null, b: TimeRange | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.start === b.start && a.end === b.end);

/**
 * Whether `span` belongs to `range`. A span counts when it *starts* inside
 * (both ends inclusive), however long it runs on: that keeps every span in
 * exactly one of two adjacent ranges and makes the counts add up.
 */
export const inRange = (span: TimelineSpan, range: TimeRange): boolean =>
  span.start >= range.start && span.start <= range.end;

export const spansInRange = (
  spans: readonly TimelineSpan[],
  range: TimeRange
): TimelineSpan[] => spans.filter((span) => inRange(span, range));

/** What happened inside a {@link TimeRange}. */
export interface RangeSummary {
  range: TimeRange;
  durationMs: number;
  /** Spans (a start/end pair counts once) that started in the range. */
  spanCount: number;
  /** Per layer, most events first; layers with none in the range are left out. */
  layers: Array<{layerId: string; count: number}>;
  /** Per component tag, busiest first. */
  components: ComponentRollup[];
}

/** Summarises the spans that start inside `range`. */
export const summarizeRange = (
  spans: readonly TimelineSpan[],
  range: TimeRange
): RangeSummary => {
  const inside = spansInRange(spans, range);
  const counts = new Map<string, number>();
  for (const span of inside) {
    counts.set(span.layerId, (counts.get(span.layerId) ?? 0) + 1);
  }
  return {
    range,
    durationMs: range.end - range.start,
    spanCount: inside.length,
    layers: [...counts]
      .map(([layerId, count]) => ({layerId, count}))
      .sort((a, b) => b.count - a.count),
    components: rollup(toUpdateCycles(inside)).sort(
      (a, b) => b.totalMs - a.totalMs || b.updates - a.updates
    ),
  };
};

/**
 * The zoom and pan (see `tracks.ts`) that fit `range` to the plot, with a
 * margin so its edges stay visible. The caller clamps them.
 */
export const fitRange = (
  originMs: number,
  extentMs: number,
  range: TimeRange
): {zoom: number; pan: number} => {
  const extent = Math.max(extentMs, 1);
  const pad = (range.end - range.start) * 0.04;
  const width = range.end - range.start + 2 * pad;
  return {zoom: extent / width, pan: range.start - pad - originMs};
};

/** Milliseconds as a short label: `850µs`, `12.3ms`, `1.25s`. */
export const formatMs = (ms: number): string => {
  const abs = Math.abs(ms);
  if (abs >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (abs >= 100) return `${ms.toFixed(0)}ms`;
  if (abs >= 1) return `${ms.toFixed(1)}ms`;
  if (abs >= 0.001) return `${(ms * 1000).toFixed(0)}µs`;
  return `${ms.toFixed(4)}ms`;
};

/** `1.2s–3.4s (2.20s)`: the bounds and the duration of a range. */
export const describeRange = (range: TimeRange): string =>
  `${formatMs(range.start)}–${formatMs(range.end)} (${formatMs(
    range.end - range.start
  )})`;
