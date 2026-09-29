/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {signal} from '@lit-labs/signals';
import {install} from 'temporal-polyfill/shim';

// Native Temporal where the browser ships it; the polyfill elsewhere (Safari
// stable, at the time of writing). Runs before anything below reads it.
install();

/**
 * Current time as a shared signal, ticking once a second. Lives in its own
 * non-component module so component edits never re-execute it — the clock
 * keeps ticking through hot patches. If this module itself is edited, the
 * dispose hook clears the stale interval before re-execution.
 */
export const now = signal(Temporal.Now.instant());

const interval = setInterval(() => {
  now.set(Temporal.Now.instant());
}, 1000);

import.meta.hot?.dispose(() => clearInterval(interval));

/**
 * Shared timezone signal — both the analog and the digital clock follow it.
 */
export const timeZone = signal(
  Intl.DateTimeFormat().resolvedOptions().timeZone
);

/** Every IANA timezone the runtime knows about (picker options). */
export const TIME_ZONES: readonly string[] = Intl.supportedValuesOf('timeZone');

/** Hours/minutes/seconds of `instant` as a wall clock in `tz` reads it. */
export const getTimeParts = (
  instant: Temporal.Instant,
  tz: string
): {hours: number; minutes: number; seconds: number} => {
  const {hour, minute, second} = instant.toZonedDateTimeISO(tz);
  return {hours: hour, minutes: minute, seconds: second};
};
