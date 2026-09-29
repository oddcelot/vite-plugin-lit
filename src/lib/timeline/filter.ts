/**
 * The Timeline's element and regex filters, as pure functions.
 *
 * Both presentations (the list and the tracks) answer "show me only this
 * element" or "only things matching /update/". The filter state therefore
 * lives in `timeline-view` and each presentation applies it here, so the two
 * cannot drift apart on what a match means.
 */

import type {TimelineEvent} from '../../types/timeline.js';
import type {TimelineSpan} from './derive.js';

/**
 * Compiles the regex box. An empty box matches everything. A pattern that
 * does not compile (the user is mid-typing `foo(`) disables the filter rather
 * than hiding every row, and is reported as `invalid` so the input can say so.
 */
export const compileRegex = (
  source: string
): {re: RegExp | null; invalid: boolean} => {
  if (source === '') return {re: null, invalid: false};
  try {
    return {re: new RegExp(source, 'i'), invalid: false};
  } catch {
    return {re: null, invalid: true};
  }
};

/** Text the regex filter searches: element tag, name, subtitle and the
 *  changed property keys (the reason is worth searching for by name). */
export const spanHaystack = (span: TimelineSpan): string =>
  `${span.meta?.tagName ?? ''} ${span.name} ${span.subtitle ?? ''} ${(
    span.changed ?? []
  ).join(' ')}`;

/**
 * Applies the element and regex filters. `re` comes from {@link compileRegex}
 * so a caller filtering on every keystroke compiles once, not per span.
 */
export const filterSpans = (
  spans: readonly TimelineSpan[],
  elementId: number | null,
  re: RegExp | null
): TimelineSpan[] =>
  spans.filter(
    (span) =>
      (elementId === null || span.meta?.elementId === elementId) &&
      (re === null || re.test(spanHaystack(span)))
  );

/** Distinct elements (by stable id) seen across the recorded events. */
export const listElements = (
  events: readonly TimelineEvent[]
): Array<{id: number; tag: string}> => {
  const seen = new Map<number, string>();
  for (const ev of events) {
    const id = ev.meta?.elementId;
    if (id != null && !seen.has(id)) {
      seen.set(id, ev.meta?.tagName ?? 'unknown');
    }
  }
  return [...seen].map(([id, tag]) => ({id, tag}));
};
