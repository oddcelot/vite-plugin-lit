/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Layout for the Timeline's track view: one horizontal lane per layer on a
 * shared time axis.
 *
 * The list answers "what happened, in what order, to whom". It cannot show
 * concurrency or rhythm — which layers fire together, how a click lines up
 * with the update tick it caused, how long a tick is next to its neighbours.
 * This module turns the same {@link TimelineSpan}s into lanes and rows, and
 * owns the arithmetic between milliseconds and pixels, so the element that
 * draws them (`panel/timeline-tracks.ts`) is only DOM.
 *
 * Pure and dependency-free, like `derive.ts`, so it is unit-tested without a
 * browser.
 */

import type {TimelineSpan} from './derive.js';

/**
 * Spans in one row of a lane, sorted by start and never overlapping, so
 * {@link visibleRange} can binary-search them.
 */
export type TrackRow = TimelineSpan[];

/** One lane: every span of one layer, packed into non-overlapping rows. */
export interface Track {
  layerId: string;
  rows: TrackRow[];
}

/**
 * Where a span stops occupying its row. A point event occupies only its own
 * instant; a span whose end has not arrived (still running, or its end fell
 * out of the buffer) occupies the rest of the recording, because that is
 * where it is drawn — up to the live edge.
 */
export const occupiedEnd = (span: TimelineSpan): number => {
  if (span.end !== undefined) return span.end;
  return span.groupId === undefined ? span.start : Infinity;
};

/**
 * Groups spans into one track per layer, in `layers` order, then any layer
 * the spans mention that `layers` does not (a custom layer announced after the
 * last `get-meta`), in first-seen order. A layer with no spans still gets an
 * empty track, so a lane does not appear and vanish as events arrive.
 *
 * Within a track, spans are packed greedily: each goes into the first row
 * whose last span has ended by the time it starts. Lit's lifecycle phases
 * nest, so one update tick lands as `performUpdate` on row 0 and
 * `willUpdate` / `update` / `updated` side by side on row 1 — the flame shape
 * falls out of the packing without modelling it.
 */
export const buildTracks = (
  spans: readonly TimelineSpan[],
  layers: readonly {id: string}[]
): Track[] => {
  const byLayer = new Map<string, TimelineSpan[]>();
  for (const layer of layers) byLayer.set(layer.id, []);
  for (const span of spans) {
    let list = byLayer.get(span.layerId);
    if (list === undefined) {
      list = [];
      byLayer.set(span.layerId, list);
    }
    list.push(span);
  }
  return [...byLayer].map(([layerId, list]) => ({
    layerId,
    rows: packRows(list),
  }));
};

const packRows = (spans: TimelineSpan[]): TrackRow[] => {
  // `toSpans` already sorts by start; re-sort only if a caller did not.
  const sorted = spans.every(
    (s, i) => i === 0 || spans[i - 1]!.start <= s.start
  )
    ? spans
    : [...spans].sort((a, b) => a.start - b.start);
  const rows: TrackRow[] = [];
  const rowEnds: number[] = [];
  for (const span of sorted) {
    let row = rowEnds.findIndex((end) => end <= span.start);
    if (row === -1) {
      row = rows.length;
      rows.push([]);
      rowEnds.push(-Infinity);
    }
    rows[row]!.push(span);
    rowEnds[row] = occupiedEnd(span);
  }
  return rows;
};

/**
 * The recording's time bounds over `spans`: the earliest start, and the
 * latest instant anything is known to have happened (an end, or the start of
 * a span with none). The origin is the earliest start rather than zero
 * because the panel's buffer is capped and rolls its oldest events off; a
 * long recording would otherwise open on an empty stretch.
 */
export const timeBounds = (
  spans: readonly TimelineSpan[]
): {origin: number; extent: number} => {
  if (spans.length === 0) return {origin: 0, extent: 0};
  let origin = Infinity;
  let last = -Infinity;
  for (const span of spans) {
    origin = Math.min(origin, span.start);
    last = Math.max(last, span.end ?? span.start);
  }
  return {origin, extent: last - origin};
};

/** Deepest zoom, in multiples of "fit": about a microsecond per pixel on a
 *  second-long recording, past which there is nothing left to separate. */
export const MAX_ZOOM = 100_000;

/** A recording with a single instant in it still needs a nonzero axis. */
const MIN_EXTENT_MS = 1;

/** Mapping between recording time and pixels for the current zoom and pan. */
export interface TimeScale {
  pxPerMs: number;
  /** First and last millisecond inside the plot. */
  start: number;
  end: number;
  toX(ms: number): number;
  toMs(x: number): number;
}

/**
 * Builds the scale for a plot `width` pixels wide showing a recording that
 * begins at `originMs` and runs for `extentMs`.
 *
 * `zoom` is a multiple of "fit" (1 shows the whole recording); `pan` is how
 * many milliseconds past the origin the left edge sits. Both are clamped, so
 * callers can apply a raw wheel or drag delta and read back where it landed.
 */
export const timeScale = (
  originMs: number,
  extentMs: number,
  width: number,
  zoom = 1,
  pan = 0
): TimeScale => {
  const extent = Math.max(extentMs, MIN_EXTENT_MS);
  const z = clampZoom(zoom);
  const visibleMs = extent / z;
  const p = clampPan(pan, extent, z);
  const pxPerMs = Math.max(width, 1) / visibleMs;
  const start = originMs + p;
  return {
    pxPerMs,
    start,
    end: start + visibleMs,
    toX: (ms) => (ms - start) * pxPerMs,
    toMs: (x) => start + x / pxPerMs,
  };
};

export const clampZoom = (zoom: number): number =>
  Math.min(Math.max(Number.isNaN(zoom) ? 1 : zoom, 1), MAX_ZOOM);

/** Keeps the visible window inside the recording. */
export const clampPan = (
  pan: number,
  extentMs: number,
  zoom: number
): number => {
  const extent = Math.max(extentMs, MIN_EXTENT_MS);
  const max = extent - extent / clampZoom(zoom);
  return Math.min(Math.max(Number.isNaN(pan) ? 0 : pan, 0), max);
};

/** The pan that puts the live edge (the end of the recording) at the right
 *  of the plot, for following a recording in progress. */
export const livePan = (extentMs: number, zoom: number): number =>
  clampPan(Infinity, extentMs, zoom);

/**
 * Zooms by `factor` while keeping the millisecond under pixel `x` where it
 * is, which is what a wheel over a timeline is expected to do.
 */
export const zoomAt = (
  originMs: number,
  extentMs: number,
  width: number,
  zoom: number,
  pan: number,
  x: number,
  factor: number
): {zoom: number; pan: number} => {
  const before = timeScale(originMs, extentMs, width, zoom, pan);
  const anchor = before.toMs(x);
  const nextZoom = clampZoom(clampZoom(zoom) * factor);
  const after = timeScale(originMs, extentMs, width, nextZoom, 0);
  const nextPan = anchor - originMs - x / after.pxPerMs;
  return {zoom: nextZoom, pan: clampPan(nextPan, extentMs, nextZoom)};
};

/**
 * Index range `[from, to)` of the spans in `row` that intersect the window
 * `[start, end]`, found by binary search so a zoomed-in lane renders a
 * handful of marks rather than walking thousands.
 *
 * Only the span just before the first one starting inside the window can
 * reach into it, because a row's spans never overlap.
 */
export const visibleRange = (
  row: TrackRow,
  start: number,
  end: number
): [number, number] => {
  const firstAtOrAfter = (t: number, inclusive: boolean) => {
    let lo = 0;
    let hi = row.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = row[mid]!.start;
      if (inclusive ? s < t : s <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let from = firstAtOrAfter(start, true);
  if (from > 0 && occupiedEnd(row[from - 1]!) >= start) from--;
  const to = firstAtOrAfter(end, false);
  return [from, Math.max(from, to)];
};

/**
 * A round tick interval (1, 2 or 5 times a power of ten, in milliseconds) at
 * least `minMs` long, for axis labels that land on readable numbers.
 */
export const niceStep = (minMs: number): number => {
  if (!(minMs > 0) || !Number.isFinite(minMs)) return 1;
  const pow = 10 ** Math.floor(Math.log10(minMs));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= minMs) return m * pow;
  }
  return 10 * pow;
};
