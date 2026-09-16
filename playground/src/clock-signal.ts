/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {signal} from '@lit-labs/signals';

/**
 * Current time as a shared signal, ticking once a second. Lives in its own
 * non-component module so component edits never re-execute it — the clock
 * keeps ticking through hot patches. If this module itself is edited, the
 * dispose hook clears the stale interval before re-execution.
 */
export const now = signal(new Date());

const interval = setInterval(() => {
  now.set(new Date());
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

const partFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Hours/minutes/seconds of `date` in `tz`, via Intl (formatters cached per
 * timezone — creating one per tick would be wasteful).
 */
export const getTimeParts = (
  date: Date,
  tz: string
): {hours: number; minutes: number; seconds: number} => {
  let formatter = partFormatters.get(tz);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
      timeZone: tz,
    });
    partFormatters.set(tz, formatter);
  }
  const parts = formatter.formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {hours: num('hour'), minutes: num('minute'), seconds: num('second')};
};
