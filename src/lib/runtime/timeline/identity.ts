/**
 * Stable per-instance id and source-meta lookup for the timeline.
 *
 * Assigns monotonic numeric ids to ReactiveElement instances via a WeakMap
 * so we never mutate the elements themselves and ids survive HMR (same
 * instance identity after in-place patching).
 *
 * Source metadata is read from the Symbol injected by the source-meta
 * transform — the same one the source-overlay feature uses — so timeline
 * events can deep-link to the component's definition file.
 */

import {SOURCE_META_KEY, readCallSite} from '../source-meta.js';
import type {TimelineEvent} from '../../../types/timeline.js';

export interface ElementSource {
  file: string;
  line: number;
}

/** A place in a file with a column, which a call site always has. */
export interface ElementCallSite extends ElementSource {
  column: number;
}

/** WeakMap avoids retaining elements after disconnection + GC. */
const ids = new WeakMap<object, number>();
let nextId = 0;

/**
 * Reverse map for {@link elementById}, so a panel request (which only carries
 * an id) can be resolved back to the live instance. WeakRef-valued so we never
 * keep an element alive past GC; dead entries are pruned on lookup.
 */
const byId = new Map<number, WeakRef<object>>();

/**
 * Drops `byId` entries as their elements are garbage-collected. The `WeakRef`
 * already lets the element itself be reclaimed, but the Map slot (id + WeakRef
 * wrapper) would otherwise linger until the next `elementById(id)` lookup —
 * which only happens on a panel request for that specific id, so on a churning
 * page (a list re-rendering thousands of rows) dead entries accumulate for the
 * whole dev session. Guarded for environments without `FinalizationRegistry`.
 */
const byIdRegistry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<number>((id) => {
        byId.delete(id);
      })
    : undefined;

/** Returns (and memoises) a stable numeric id for an element instance. */
export const idOf = (el: object): number => {
  let id = ids.get(el);
  if (id === undefined) {
    id = nextId++;
    ids.set(el, id);
    byId.set(id, new WeakRef(el));
    byIdRegistry?.register(el, id);
  }
  return id;
};

/**
 * Resolves an id back to its element instance, or `undefined` if it was never
 * seen or has since been garbage-collected. Used by the inspector to act on the
 * id the panel sends (details, watch, highlight).
 */
export const elementById = (id: number): Element | undefined => {
  const el = byId.get(id)?.deref();
  if (el === undefined) {
    byId.delete(id);
    return undefined;
  }
  return el as Element;
};

/** Reads the file/line source metadata injected by the plugin transform. */
export const sourceOf = (el: object): ElementSource | undefined => {
  const ctor = (el as {constructor?: Record<symbol, unknown>}).constructor;
  if (ctor === undefined) return undefined;
  const meta = ctor[SOURCE_META_KEY] as
    | {filePath?: string; lineNumber?: number}
    | undefined;
  if (meta?.filePath === undefined) return undefined;
  return {file: meta.filePath, line: meta.lineNumber ?? 1};
};

/**
 * Extracts the changed property keys from a PropertyValues argument.
 * Returns undefined when `changed` is not a Map (e.g. for lifecycle hooks
 * that don't receive a changed-properties argument).
 */
export const changedKeys = (changed: unknown): string[] | undefined => {
  if (!(changed instanceof Map)) return undefined;
  return [...changed.keys()].map((k) =>
    typeof k === 'symbol' ? k.toString() : String(k)
  );
};

/** Where `el` was written in a template, from the attribute the dev transform stamps. */
export const callSiteOf = (el: object): ElementCallSite | undefined => {
  if (typeof (el as Element).getAttribute !== 'function') return undefined;
  const site = readCallSite(el as Element);
  return site === undefined
    ? undefined
    : {file: site.filePath, line: site.lineNumber, column: site.columnNumber};
};

/**
 * The identity every timeline event of `el` carries: id, tag, where the class
 * is declared and, for an element written in a template, where that is.
 */
export const metaOf = (el: object): NonNullable<TimelineEvent['meta']> => {
  const callSite = callSiteOf(el);
  return {
    elementId: idOf(el),
    tagName: (el as Element).localName ?? 'unknown',
    source: sourceOf(el),
    ...(callSite === undefined ? {} : {callSite}),
  };
};
