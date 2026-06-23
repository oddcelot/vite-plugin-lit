/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Recording-relative clock for the timeline.
 *
 * Built-in capture layers timestamp events with {@link now} rather than raw
 * `performance.now()`, so event times read as "ms since recording started"
 * (the first event is ~0) instead of "ms since the app page loaded" — which is
 * also meaningless to the panel, an iframe with its own time origin. The origin
 * is re-zeroed on each rising edge of recording via {@link resetClock}.
 */

let epoch = 0;

/** Re-zero the clock; called when recording transitions off → on. */
export const resetClock = (): void => {
  epoch = performance.now();
};

/** Milliseconds since the last {@link resetClock}. */
export const now = (): number => performance.now() - epoch;
