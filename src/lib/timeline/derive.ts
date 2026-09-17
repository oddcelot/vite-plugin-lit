/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Derivation over recorded timeline events.
 *
 * The capture layers emit one event per phase boundary, which is the right
 * wire format and the wrong thing to read: a single update tick of one
 * component is five to ten rows whose durations the reader has to subtract by
 * hand. Everything needed to do better is already on the events — `groupId`
 * pairs a start with its end, `data.changed` names the reactive properties
 * that caused the update — so this module turns a flat event list into the
 * three shapes the panel and agents actually ask for:
 *
 * - {@link TimelineSpan} — a start/end pair collapsed into one entry with a
 *   duration ("`update` took 1.8ms").
 * - {@link UpdateCycle} — one component's whole update tick, with the changed
 *   property keys that triggered it ("`<hmr-counter>` updated because
 *   `count` changed").
 * - {@link ComponentRollup} — per-component totals over a recording ("this
 *   component updated 340 times for 120ms").
 *
 * Pure and dependency-free by design: it imports only the shared event types,
 * so the panel derives client-side over its 5000-event buffer and
 * `devframe/definition.ts` — which must stay framework-neutral — can derive
 * server-side over the ring buffer for the agent-facing summary.
 */

import type {TimelineEvent} from '../../types/timeline.js';

/** Layer whose events describe Lit update ticks. */
const LIFECYCLE_LAYER_ID = 'lit-lifecycle';

/** Layers whose events are developer input, for {@link attributeInput}. */
const INPUT_LAYER_IDS: readonly string[] = ['mouse', 'keyboard'];

/** The phase that brackets an entire update tick. */
const ROOT_PHASE = 'performUpdate';

const START_SUFFIX = ':start';
const END_SUFFIX = ':end';

/**
 * A start/end pair collapsed into one entry, or a point event that never had
 * an end to begin with.
 */
export interface TimelineSpan {
  layerId: string;
  /**
   * Stable across re-derivation of the same events, which a Lit `repeat()`
   * key and a selection comparison both need — the span objects themselves
   * are rebuilt whenever the event buffer changes.
   */
  key: string;
  /** The event title with its `:start` / `:end` suffix removed. */
  name: string;
  /** Pairing id as emitted; `undefined` for point events. */
  groupId?: number | string;
  start: number;
  /** Absent while the span is still open, or if its end was never recorded. */
  end?: number;
  /** `end - start`. Absent for open spans and for point events. */
  duration?: number;
  /** Reactive property keys that caused this update, where the phase has them. */
  changed?: string[];
  subtitle?: string;
  logType?: TimelineEvent['logType'];
  meta?: TimelineEvent['meta'];
  /** The events this span was built from, for the detail pane. */
  events: TimelineEvent[];
}

/** One component's complete update tick. */
export interface UpdateCycle {
  /** The `${elementId}:${tick}` groupId the phases share. */
  key: string;
  elementId: number;
  tagName: string;
  source?: {file: string; line: number};
  start: number;
  /** The `performUpdate` span's duration — see {@link toUpdateCycles}. */
  duration?: number;
  /** Union of the changed reactive property keys across the tick's phases. */
  changed: string[];
  phases: TimelineSpan[];
  /** The input event this update followed, if any. See {@link attributeInput}. */
  cause?: {layerId: string; type: string; detail?: string; time: number};
}

/** Per-component totals over a set of update cycles. */
export interface ComponentRollup {
  tagName: string;
  /** Every instance of this component that updated, in first-seen order. */
  elementIds: number[];
  updates: number;
  /** Summed `performUpdate` durations; excludes cycles with no measured end. */
  totalMs: number;
  maxMs: number;
  /** Changed-key frequency across the cycles, most frequent first. */
  reasons: Array<{key: string; count: number}>;
  source?: {file: string; line: number};
}

/** Reads `data.changed` defensively — `data` is `unknown` on the wire. */
const changedOf = (event: TimelineEvent): string[] | undefined => {
  const data = event.data;
  if (data === null || typeof data !== 'object') return undefined;
  const changed = (data as {changed?: unknown}).changed;
  if (!Array.isArray(changed)) return undefined;
  const keys = changed.filter((key): key is string => typeof key === 'string');
  return keys.length > 0 ? keys : undefined;
};

const pointSpan = (event: TimelineEvent, index: number): TimelineSpan => ({
  layerId: event.layerId,
  key: `${event.layerId}:point:${index}`,
  name: event.title ?? event.layerId,
  start: event.time,
  changed: changedOf(event),
  subtitle: event.subtitle,
  logType: event.logType,
  meta: event.meta,
  events: [event],
});

/**
 * Collapses `:start` / `:end` event pairs into spans, passing anything else
 * through as a point span.
 *
 * Pairing is keyed on **layer + groupId + phase name**, never on `groupId`
 * alone: a whole update tick shares one groupId (`runtime/timeline/
 * lifecycle.ts` builds it as `${elementId}:${tick}`), so matching on the id
 * would marry `willUpdate:start` to `performUpdate:end`. Each phase occurs at
 * most once per tick, which makes the triple unique.
 *
 * Unmatched halves survive rather than disappear — the buffer is a bounded
 * ring, so its oldest end and its newest start routinely have no partner, and
 * an update that is still running has a genuinely open span.
 */
export const toSpans = (events: readonly TimelineEvent[]): TimelineSpan[] => {
  const spans: TimelineSpan[] = [];
  const open = new Map<string, TimelineSpan>();

  events.forEach((event, index) => {
    const title = event.title ?? event.layerId;
    const isStart = title.endsWith(START_SUFFIX);
    const isEnd = !isStart && title.endsWith(END_SUFFIX);

    if (event.groupId === undefined || (!isStart && !isEnd)) {
      spans.push(pointSpan(event, index));
      return;
    }

    const name = title.slice(
      0,
      -(isStart ? START_SUFFIX.length : END_SUFFIX.length)
    );
    const key = `${event.layerId}:${event.groupId}:${name}`;

    if (isStart) {
      const span: TimelineSpan = {
        layerId: event.layerId,
        key,
        name,
        groupId: event.groupId,
        start: event.time,
        changed: changedOf(event),
        subtitle: event.subtitle,
        logType: event.logType,
        meta: event.meta,
        events: [event],
      };
      open.set(key, span);
      // Pushed on its start, so the list is already in start order and an
      // open span keeps its place instead of appearing when it finally ends.
      spans.push(span);
      return;
    }

    const span = open.get(key);
    if (span === undefined) {
      spans.push(pointSpan(event, index));
      return;
    }
    open.delete(key);
    span.events.push(event);
    // A negative delta means the buffer straddles a clock reset (the runtime
    // re-zeroes on the rising edge of recording). Report no duration rather
    // than a negative one; the span stays open, which is what it honestly is.
    if (event.time >= span.start) {
      span.end = event.time;
      span.duration = event.time - span.start;
    }
    span.changed ??= changedOf(event);
  });

  return spans.sort((a, b) => a.start - b.start);
};

/**
 * Groups lifecycle spans into update ticks.
 *
 * `duration` is taken from the `performUpdate` span alone, never from a sum of
 * the phases: `willUpdate` / `update` / `updated` all run *inside*
 * `performUpdate`, so summing counts the same milliseconds several times over.
 *
 * `changed` is the union across the tick's phases because only the phases that
 * receive a `PropertyValues` argument carry it — `performUpdate` takes none,
 * so the bracketing span is always silent about the reason.
 */
export const toUpdateCycles = (
  spans: readonly TimelineSpan[]
): UpdateCycle[] => {
  const byGroup = new Map<string, UpdateCycle>();

  for (const span of spans) {
    const elementId = span.meta?.elementId;
    if (
      span.layerId !== LIFECYCLE_LAYER_ID ||
      span.groupId === undefined ||
      elementId === undefined
    ) {
      // Point lifecycle events (connect/disconnect) have no groupId and are
      // not update ticks; other layers are not this function's business.
      continue;
    }

    const key = String(span.groupId);
    let cycle = byGroup.get(key);
    if (cycle === undefined) {
      cycle = {
        key,
        elementId,
        tagName: span.meta?.tagName ?? 'unknown',
        source: span.meta?.source,
        start: span.start,
        changed: [],
        phases: [],
      };
      byGroup.set(key, cycle);
    }

    cycle.phases.push(span);
    if (span.start < cycle.start) cycle.start = span.start;
    if (span.name === ROOT_PHASE) cycle.duration = span.duration;
    for (const changedKey of span.changed ?? []) {
      if (!cycle.changed.includes(changedKey)) cycle.changed.push(changedKey);
    }
  }

  return [...byGroup.values()].sort((a, b) => a.start - b.start);
};

/**
 * Totals update cycles per component tag.
 *
 * Grouped by tag rather than by instance because the question this answers is
 * "which *component* re-renders too much" — a list of 200 rows each updating
 * twice is one component's problem, not 200. The instance ids are kept so the
 * caller can still drill in.
 */
export const rollup = (cycles: readonly UpdateCycle[]): ComponentRollup[] => {
  const byTag = new Map<
    string,
    {entry: ComponentRollup; reasons: Map<string, number>}
  >();

  for (const cycle of cycles) {
    let record = byTag.get(cycle.tagName);
    if (record === undefined) {
      record = {
        entry: {
          tagName: cycle.tagName,
          elementIds: [],
          updates: 0,
          totalMs: 0,
          maxMs: 0,
          reasons: [],
          source: cycle.source,
        },
        reasons: new Map(),
      };
      byTag.set(cycle.tagName, record);
    }

    const {entry, reasons} = record;
    entry.updates++;
    if (!entry.elementIds.includes(cycle.elementId)) {
      entry.elementIds.push(cycle.elementId);
    }
    entry.source ??= cycle.source;
    // An open or clock-straddling cycle contributes a count but no time —
    // better than inventing one, and the count is what flags a hot component.
    if (cycle.duration !== undefined) {
      entry.totalMs += cycle.duration;
      if (cycle.duration > entry.maxMs) entry.maxMs = cycle.duration;
    }
    for (const key of cycle.changed) {
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  }

  const entries: ComponentRollup[] = [];
  for (const {entry, reasons} of byTag.values()) {
    entry.reasons = [...reasons]
      .map(([key, count]) => ({key, count}))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    entries.push(entry);
  }

  // Slowest first, then most frequent: a component with no measured durations
  // still sorts above a quiet one.
  return entries.sort((a, b) => b.totalMs - a.totalMs || b.updates - a.updates);
};

/**
 * Attributes each update cycle to the input event that preceded it, within
 * `windowMs`.
 *
 * This is what the mouse and keyboard layers are for. On their own they
 * duplicate what the browser's own event log already shows; joined to the
 * updates they precede they answer the question the raw layers only imply —
 * an update with a cause is an interaction, and an update without one is a
 * timer, a signal, or a stray `requestUpdate()`.
 *
 * Returns a new array; cycles with no cause are returned as-is.
 */
export const attributeInput = (
  cycles: readonly UpdateCycle[],
  events: readonly TimelineEvent[],
  windowMs = 200
): UpdateCycle[] => {
  const inputs = events
    .filter((event) => INPUT_LAYER_IDS.includes(event.layerId))
    .sort((a, b) => a.time - b.time);
  if (inputs.length === 0) return [...cycles];

  // Both sides are sorted by time, so one forward pass suffices.
  let cursor = 0;
  return cycles.map((cycle) => {
    while (
      cursor + 1 < inputs.length &&
      inputs[cursor + 1]!.time <= cycle.start
    ) {
      cursor++;
    }
    const candidate = inputs[cursor]!;
    const delta = cycle.start - candidate.time;
    if (delta < 0 || delta > windowMs) return cycle;
    return {
      ...cycle,
      cause: {
        layerId: candidate.layerId,
        type: candidate.title ?? candidate.layerId,
        detail: candidate.subtitle,
        time: candidate.time,
      },
    };
  });
};
