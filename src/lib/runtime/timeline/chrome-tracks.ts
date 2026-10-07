/**
 * Mirrors timeline events into Chrome DevTools' Performance panel as custom
 * tracks, via `console.timeStamp(label, start, end, track, group, color)`.
 * Browsers that ignore those arguments get the same entries as User Timing
 * marks and measures instead (see {@link userTimingStamp}).
 *
 * Start/end are `performance.now()` values. Paired `:start`/`:end` events
 * become a range; everything else becomes a zero-length marker.
 */

import type {TimelineEvent} from '../../../types/timeline.js';
import {toPerfTime} from './clock.js';

type TrackColor =
  | 'primary'
  | 'primary-light'
  | 'primary-dark'
  | 'secondary'
  | 'secondary-light'
  | 'secondary-dark'
  | 'tertiary'
  | 'tertiary-light'
  | 'tertiary-dark'
  | 'error';

export type TimeStamp = (
  label: string,
  start: number,
  end: number,
  track: string,
  group: string,
  color: TrackColor
) => void;

export interface ChromeTracksSink {
  push(event: TimelineEvent): void;
  reset(): void;
}

const GROUP = 'Lit';
const MAX_PENDING = 1000;

const TRACKS: Record<string, {track: string; color: TrackColor; lit: boolean}> =
  {
    'lit-lifecycle': {track: 'Lifecycle', color: 'primary', lit: true},
    'lit-render': {track: 'Render', color: 'secondary', lit: true},
    'lit-render-verbose': {
      track: 'Render (verbose)',
      color: 'secondary-light',
      lit: true,
    },
    mouse: {track: 'Input', color: 'tertiary', lit: false},
    keyboard: {track: 'Input', color: 'tertiary', lit: false},
  };

interface NavigatorLike {
  userAgent?: string;
  userAgentData?: {brands?: readonly {brand: string; version: string}[]};
}

/**
 * Whether this browser draws `console.timeStamp`'s track arguments: Chromium
 * 134 or newer. There's no feature test for the extra arguments (older
 * Chrome, Firefox and Safari accept the call and ignore them), so this reads
 * the version. `userAgentData` only exists in secure contexts, so a dev
 * server reached over plain http on a LAN address falls back to the UA
 * string's `Chrome/<major>`, which every Chromium browser keeps.
 */
export const chromeTracksSupported = (
  nav: NavigatorLike | undefined = globalThis.navigator
): boolean => {
  const brand = nav?.userAgentData?.brands?.find((b) => b.brand === 'Chromium');
  const major = brand
    ? Number(brand.version)
    : Number(/\bChrome\/(\d+)/.exec(nav?.userAgent ?? '')?.[1]);
  return major >= 134;
};

const consoleStamp: TimeStamp = (...args) => {
  const c = console as unknown as {timeStamp?: TimeStamp};
  if (typeof c.timeStamp === 'function') c.timeStamp(...args);
};

/**
 * The same entries as User Timing: a range becomes a measure, a marker a
 * mark, named `lit:<track> <label>` so a profiler's filter finds them. The
 * Firefox Profiler shows them in its Marker Chart. Each entry is cleared
 * right after it's made: profilers record it when it's made, and the page's
 * own performance timeline, which nothing trims, shouldn't fill up with a
 * page's worth of updates.
 */
export const userTimingStamp: TimeStamp = (label, start, end, track) => {
  const name = `lit:${track} ${label}`;
  try {
    if (start === end) {
      performance.mark(name, {startTime: start});
      performance.clearMarks(name);
    } else {
      performance.measure(name, {start, end});
      performance.clearMeasures(name);
    }
  } catch {
    // A time before the page's time origin throws; drop the entry.
  }
};

/** The stamp for this browser: Chrome's tracks where it draws them. */
export const profilerStamp = (tracks: boolean): TimeStamp =>
  tracks ? consoleStamp : userTimingStamp;

export const createChromeTracksSink = (
  stamp: TimeStamp = consoleStamp,
  toPerf: (t: number) => number = toPerfTime
): ChromeTracksSink => {
  // Start times are converted at receipt because the clock epoch can reset
  // before the matching :end arrives.
  const pending = new Map<string, {start: number; error: boolean}>();

  return {
    push(event) {
      const cfg = TRACKS[event.layerId];
      if (cfg === undefined) return;
      const title = event.title ?? '';
      const isError = event.logType === 'error';
      const isStart = title.endsWith(':start');
      const isEnd = title.endsWith(':end');
      const phase =
        isStart || isEnd ? title.slice(0, title.lastIndexOf(':')) : title;
      const tag = cfg.lit ? (event.meta?.tagName ?? event.subtitle) : undefined;
      const label = tag ? `<${tag}> ${phase}` : phase;

      if (isStart) {
        const key = `${event.layerId}|${event.groupId}|${phase}`;
        pending.delete(key);
        pending.set(key, {start: toPerf(event.time), error: isError});
        if (pending.size > MAX_PENDING) {
          const oldest = pending.keys().next().value;
          if (oldest !== undefined) pending.delete(oldest);
        }
      } else if (isEnd) {
        const key = `${event.layerId}|${event.groupId}|${phase}`;
        const p = pending.get(key);
        if (p === undefined) return;
        pending.delete(key);
        stamp(
          label,
          p.start,
          toPerf(event.time),
          cfg.track,
          GROUP,
          p.error || isError ? 'error' : cfg.color
        );
      } else {
        const t = toPerf(event.time);
        stamp(label, t, t, cfg.track, GROUP, isError ? 'error' : cfg.color);
      }
    },
    reset() {
      pending.clear();
    },
  };
};
