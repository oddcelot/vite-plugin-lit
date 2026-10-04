/**
 * The Timeline's state model: recorded events plus the reader's filter and
 * selection, and the rules that keep them consistent as the buffer changes.
 *
 * The derivations ({@link toSpans}, {@link filterSpans}, …) are pure, but
 * applying them is stateful: a selection can fall out of the buffer cap, an
 * element filter can name an element that Clear just removed, and a deep link
 * can arrive before the events it names have streamed in. Those rules live
 * here rather than in `timeline-view`, so they are unit-testable without a
 * DOM, and the selection key format is defined in one place.
 *
 * Framework-free like the rest of `lib/timeline`: the devframe definition
 * derives server-side through {@link updateCycles} too.
 */

import type {TimelineEvent} from '../../types/timeline.js';
import {attributeInput, rollup, toSpans, toUpdateCycles} from './derive.js';
import type {ComponentRollup, TimelineSpan, UpdateCycle} from './derive.js';
import {compileRegex, filterSpans, listElements} from './filter.js';

const RAW_KEY_PREFIX = 'raw:';

/** Whether `key` names a Raw-mode row rather than a collapsed span. */
export const isRawKey = (key: string): boolean =>
  key.startsWith(RAW_KEY_PREFIX);

/**
 * Adapts one raw event to the row shape for the list's Raw toggle.
 * Deliberately drops `groupId`: pairing is what the collapsed mode is for,
 * and without it the duration cell reads "point event" rather than "still
 * open".
 */
export const rawRow = (event: TimelineEvent, index: number): TimelineSpan => ({
  layerId: event.layerId,
  key: `${RAW_KEY_PREFIX}${index}`,
  name: event.title ?? event.layerId,
  start: event.time,
  subtitle: event.subtitle,
  logType: event.logType,
  meta: event.meta,
  events: [event],
});

/** The element and regex filters both presentations apply. */
export interface TimelineFilter {
  /** Element id to show, or null for all elements. */
  elementId: number | null;
  /** Case-insensitive regex source; empty matches everything. */
  regex: string;
}

export const NO_FILTER: TimelineFilter = {elementId: null, regex: ''};

/** Applies a {@link TimelineFilter} to spans or Raw-mode rows. */
export const applyFilter = (
  rows: readonly TimelineSpan[],
  filter: TimelineFilter
): TimelineSpan[] =>
  filterSpans(rows, filter.elementId, compileRegex(filter.regex).re);

/** Update cycles over `events`, each attributed to the input it followed. */
export const updateCycles = (events: readonly TimelineEvent[]): UpdateCycle[] =>
  attributeInput(toUpdateCycles(toSpans(events)), events);

/** {@link updateCycles} plus their per-component {@link rollup}. */
export const summarizeUpdates = (
  events: readonly TimelineEvent[]
): {cycles: UpdateCycle[]; components: ComponentRollup[]} => {
  const cycles = updateCycles(events);
  return {cycles, components: rollup(cycles)};
};

/**
 * Events, filter and selection for the Timeline view, derived lazily and
 * memoised on identity: the event array is replaced (never mutated) whenever
 * the buffer changes, and every derived array keeps its identity until one of
 * its inputs changes, so a selection change does not hand the tracks a new
 * array and re-pack every lane.
 */
export class TimelineModel {
  private _events: readonly TimelineEvent[] = [];
  private _spans: TimelineSpan[] = [];
  private _elements: Array<{id: number; tag: string}> = [];
  private _filter: TimelineFilter = NO_FILTER;
  private _filtered: TimelineSpan[] | null = [];
  private _selectedKey: string | null = null;

  get events(): readonly TimelineEvent[] {
    return this._events;
  }

  /** `toSpans(events)`. */
  get spans(): TimelineSpan[] {
    return this._spans;
  }

  /** Distinct elements in the buffer, for the element picker. */
  get elements(): Array<{id: number; tag: string}> {
    return this._elements;
  }

  get filter(): TimelineFilter {
    return this._filter;
  }

  /** Whether the regex box holds a pattern that does not compile. */
  get regexInvalid(): boolean {
    return compileRegex(this._filter.regex).invalid;
  }

  /** {@link spans} after the filter. */
  get filteredSpans(): TimelineSpan[] {
    this._filtered ??= applyFilter(this._spans, this._filter);
    return this._filtered;
  }

  get selectedKey(): string | null {
    return this._selectedKey;
  }

  /** The selected span, or undefined for none or a Raw-mode row. */
  get selectedSpan(): TimelineSpan | undefined {
    const key = this._selectedKey;
    return key === null ? undefined : this._spans.find((s) => s.key === key);
  }

  /** Id of the selected span's start event, for the URL. */
  get selectedEventId(): string | null {
    return this.selectedSpan?.events[0]?.id ?? null;
  }

  /**
   * Replaces the buffer and reconciles the filter and selection against it.
   * Returns false when `events` is the buffer it already has.
   */
  setEvents(events: readonly TimelineEvent[]): boolean {
    if (events === this._events) return false;
    this._events = events;
    this._spans = toSpans(events);
    this._elements = listElements(events);
    this._filtered = null;
    // A filter on an element no longer recorded (e.g. after Clear) would
    // silently show nothing.
    const {elementId} = this._filter;
    if (
      elementId !== null &&
      !this._elements.some((el) => el.id === elementId)
    ) {
      this._filter = {...this._filter, elementId: null};
    }
    // A span can fall out of the buffer cap, or vanish on Clear. Raw-mode
    // keys index the events and are the list's to interpret.
    const key = this._selectedKey;
    if (key !== null && !isRawKey(key) && this.selectedSpan === undefined) {
      this._selectedKey = null;
    }
    return true;
  }

  setFilter(patch: Partial<TimelineFilter>): void {
    const next = {...this._filter, ...patch};
    if (
      next.elementId === this._filter.elementId &&
      next.regex === this._filter.regex
    ) {
      return;
    }
    this._filter = next;
    this._filtered = null;
  }

  /** A click on a row or mark. */
  select(key: string | null): void {
    this._selectedKey = key;
  }

  /**
   * Selects the span a deep link named. Its start event is the natural target
   * (`span.events[0]`), but any of the span's events matches, so a link to
   * either half of a pair lands on the same row. An id the buffer does not
   * hold (evicted, or from another session) clears the selection: leaving the
   * previous row highlighted would read as if that were it. Returns true when
   * it found a span.
   *
   * Holding a link until the buffer has loaded is `PanelLocation`'s; ask only
   * once {@link events} has some.
   */
  selectEvent(id: string): boolean {
    const span = this._spans.find((s) => s.events.some((e) => e.id === id));
    this._selectedKey = span?.key ?? null;
    return span !== undefined;
  }
}
