/**
 * @license
 * Copyright 2026 Google LLC
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

    const reader = rpc.rpc.streaming.subscribe<TimelineEvent[]>(
      meta.stream.channel,
      meta.stream.id,
      {highWaterMark: 4096}
    );

    // No recording check here: every capture layer in the page runtime is
    // already gated on the recording flag, so anything that reaches the
    // stream was recorded on purpose. Gating again client-side would throw
    // away the replayed buffer that makes a late-opened panel useful.
    for await (const batch of reader) {
      const next = [...events, ...batch];
      events = next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      notify();
    }
  } catch (err) {
    error = describeError(err);
    notify();
  }
};
