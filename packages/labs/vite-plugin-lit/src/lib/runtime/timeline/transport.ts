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

/** Register the HMR hot client. Called by install.ts after import.meta.hot check. */
export const setHotClient = (hot: HotClient): void => {
  hotClient = hot;
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
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
};
