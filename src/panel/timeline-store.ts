/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The panel's single recorded-event buffer.
 *
 * More than one view reads the recording — the Timeline lists it, the Updates
 * tab derives update cycles from it — and both want the whole window, not a
 * slice. A per-view subscription would open a second reader on the same
 * devframe stream and keep a second copy of every event, so the buffer lives
 * here instead and the views are consumers.
 *
 * Module-scoped and started on first subscribe, for the panel document's
 * lifetime: the Timeline view is mounted (though hidden) the whole time
 * anyway, so there is no teardown case worth the complexity of ref-counting
 * the stream — and dropping the buffer whenever the developer switched tabs
 * would defeat the point of recording.
 */

import {litRpc, getMeta, describeError, isSnapshot} from './client.js';
import type {TimelineEvent} from '../types/timeline.js';

/**
 * Cap on retained timeline events. The stream is unbounded (the mouse/keyboard
 * layers can emit at pointer-move rate), so without a cap the buffer — and the
 * views that re-render from it — grow for the whole session. Keep the most
 * recent events; older ones scroll off.
 */
const MAX_EVENTS = 5000;

/**
 * sessionStorage key for the id of the newest event Clear (or a fresh
 * recording) threw away. A reloaded panel is refilled from the node's
 * `timeline-history`, which Clear does not touch (agents still read the same
 * buffer through `recent-events`), so without this a reload would resurrect
 * everything the developer cleared. sessionStorage, not a module variable:
 * the point is to survive the reload. Ids are `${epoch}-${seq}` with a seq
 * that never resets across Clear (see `devframe/definition.ts`).
 */
const CLEARED_THROUGH_KEY = 'lit-devtools:timeline-cleared-through';

const parseEventId = (
  id: string | undefined
): {epoch: string; seq: number} | undefined => {
  if (id === undefined) return undefined;
  const cut = id.lastIndexOf('-');
  const seq = Number(id.slice(cut + 1));
  return cut > 0 && Number.isInteger(seq)
    ? {epoch: id.slice(0, cut), seq}
    : undefined;
};

const readClearedThrough = (): {epoch: string; seq: number} | undefined => {
  try {
    return parseEventId(
      sessionStorage.getItem(CLEARED_THROUGH_KEY) ?? undefined
    );
  } catch {
    return undefined;
  }
};

const rememberClearedThrough = (id: string): void => {
  try {
    sessionStorage.setItem(CLEARED_THROUGH_KEY, id);
  } catch {
    // Storage blocked: a reload then brings cleared events back. Harmless.
  }
};

/** Drops events at or before the cleared-through mark. A mark from another
 *  epoch belongs to an earlier dev server and says nothing about these ids. */
const withoutCleared = (batch: TimelineEvent[]): TimelineEvent[] => {
  const mark = readClearedThrough();
  if (mark === undefined) return batch;
  return batch.filter((event) => {
    const id = parseEventId(event.id);
    return id === undefined || id.epoch !== mark.epoch || id.seq > mark.seq;
  });
};

let events: TimelineEvent[] = [];
let error: string | null = null;
let started = false;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

/** The retained events, oldest first. Replaced, never mutated in place, so a
 *  consumer can use identity to decide whether to re-derive. */
export const getTimelineEvents = (): TimelineEvent[] => events;

/** Connection failure from the initial subscribe, or null. */
export const getTimelineError = (): string | null => error;

export const clearTimelineEvents = (): void => {
  if (events.length === 0) return;
  const newest = events[events.length - 1]!.id;
  if (newest !== undefined) rememberClearedThrough(newest);
  events = [];
  notify();
};

/**
 * Subscribes to buffer changes and starts the reader on first use. The
 * returned function unsubscribes; it does not stop the reader.
 */
export const subscribeTimeline = (listener: () => void): (() => void) => {
  listeners.add(listener);
  void start();
  return () => {
    listeners.delete(listener);
  };
};

const start = async (): Promise<void> => {
  if (started) return;
  started = true;
  try {
    const [rpc, meta] = await Promise.all([litRpc(), getMeta()]);

    // A frozen session has no live stream to subscribe to -- the events were
    // baked into `recent-events` at export time, and they are the whole point
    // of the snapshot. Read them once and stop.
    if (isSnapshot()) {
      const recorded = await rpc.rpc.call('recent-events', {});
      events = recorded.events.slice(-MAX_EVENTS);
      notify();
      return;
    }

    // Subscribe before asking for history. The stream carries only events
    // written after this point, and the history call is processed after the
    // subscribe on the same connection, so nothing falls between the two; an
    // event written in between shows up in both and is dropped below by id.
    const reader = rpc.rpc.streaming.subscribe<TimelineEvent[]>(
      meta.stream.channel,
      meta.stream.id,
      {highWaterMark: 4096}
    );

    // Seed with what the node already recorded, so a panel opened or
    // reloaded mid-session is not blank. One batch, so a deep link into it
    // resolves against the whole seed. A failed call is not fatal: the panel
    // is then just a late one, as it was before.
    const history = await rpc.rpc.call('timeline-history').catch(() => []);
    const seeded = withoutCleared(history).slice(-MAX_EVENTS);
    const seededIds = new Set(seeded.map((event) => event.id));
    if (seeded.length > 0) {
      events = seeded;
      notify();
    }

    // No recording check here: every capture layer in the page runtime is
    // already gated on the recording flag, so anything that reaches the
    // stream was recorded on purpose.
    for await (const batch of reader) {
      const fresh = withoutCleared(batch).filter(
        (event) => event.id === undefined || !seededIds.has(event.id)
      );
      if (fresh.length === 0) continue;
      const next = [...events, ...fresh];
      events = next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      notify();
    }
  } catch (err) {
    error = describeError(err);
    notify();
  }
};
