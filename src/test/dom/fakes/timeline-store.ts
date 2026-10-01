/**
 * Stand-in for `src/panel/timeline-store.ts`, for panel views under
 * happy-dom. Mock the real module with it:
 *
 *   vi.mock('../../panel/timeline-store.js', () => import('./fakes/timeline-store.js'));
 *
 * then drive it with {@link setEvents}. Like the real store it hands out a new
 * array per change, which the views use as their memo key.
 */
import type {TimelineEvent} from '../../../types/timeline.js';

let events: TimelineEvent[] = [];
let error: string | null = null;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

export const getTimelineEvents = (): TimelineEvent[] => events;
export const getTimelineError = (): string | null => error;

export const clearTimelineEvents = (): void => {
  events = [];
  notify();
};

export const subscribeTimeline = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test control: replace the buffer and notify subscribers. */
export const setEvents = (next: readonly TimelineEvent[]): void => {
  events = [...next];
  notify();
};

/** Test control: report a store error. */
export const setError = (next: string | null): void => {
  error = next;
  notify();
};

/** Test control: back to an empty, error-free store with no subscribers. */
export const resetStore = (): void => {
  events = [];
  error = null;
  listeners.clear();
};
