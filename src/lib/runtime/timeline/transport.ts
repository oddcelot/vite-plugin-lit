/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Buffered transport for timeline events.
 *
 * Phase 0/1: forwards events over Vite's HMR WebSocket channel
 * (`import.meta.hot.send`). This avoids the need for a separate devframe
 * RPC connection in early phases and works with any Vite dev server.
 *
 * Phase 2 migration: replace `sendViaHmr` with `sendViaRpc` when the
 * devframe RPC client is available (injected by the panel's clientScript).
 *
 * Batching: we coalesce events with `queueMicrotask` so a burst of
 * commit/set-part events from a single render doesn't hammer the channel
 * with one message per event.
 */

import type {TimelineEvent} from '../../../types/timeline.js';

type HotClient = {
  send: (event: string, data: unknown) => void;
};

const queue: TimelineEvent[] = [];
let flushScheduled = false;
let hotClient: HotClient | null = null;

/**
 * Cap on events retained while no hot client is connected. Without a client
 * `flush()` cannot drain the queue, so an uncapped buffer would grow for the
 * whole session (in production, or before `install.ts` wires the client).
 * We keep only the most recent events; the retained tail flushes if a client
 * later connects.
 */
const MAX_PENDING = 1000;

// Callbacks registered before the hot client was available (e.g. addTimelineLayer
// called at module init time before install.ts has set the client).
const pendingCallbacks: Array<() => void> = [];

/**
 * Register the HMR hot client.
 * Called by install.ts after import.meta.hot check.
 * Flushes any queued events and fires pending one-shot callbacks.
 */
export const setHotClient = (hot: HotClient): void => {
  hotClient = hot;
  // Drain any events that arrived before the client was wired.
  if (queue.length > 0 && !flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
  // Fire one-shot callbacks (e.g. addTimelineLayer announcements).
  for (const cb of pendingCallbacks.splice(0)) {
    try {
      cb();
    } catch {
      // ignore
    }
  }
};

/**
 * Register a callback to be invoked once the HMR client is available.
 * If the client is already set the callback is fired on the next microtask.
 */
export const setHotClientCallback = (cb: () => void): void => {
  if (hotClient !== null) {
    queueMicrotask(cb);
  } else {
    pendingCallbacks.push(cb);
  }
};

const flush = (): void => {
  flushScheduled = false;
  if (queue.length === 0 || hotClient === null) return;
  const batch = queue.splice(0);
  try {
    hotClient.send('lit:timeline:push-event', {events: batch});
  } catch {
    // HMR channel may be temporarily unavailable; events are dropped.
  }
};

/**
 * Enqueue a timeline event for forwarding to the Vite server.
 * Batches via microtask so a single synchronous render burst
 * doesn't send dozens of individual messages.
 */
export const emit = (event: TimelineEvent): void => {
  queue.push(event);
  if (hotClient === null) {
    // No consumer yet: bound the buffer instead of scheduling a flush that
    // would only no-op. `setHotClient` drains the retained tail on connect.
    if (queue.length > MAX_PENDING) {
      queue.splice(0, queue.length - MAX_PENDING);
    }
    return;
  }
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
};
