/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

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

export interface ElementSource {
  file: string;
  line: number;
}

const SOURCE_META_KEY = Symbol.for('@lit-labs/vite-plugin-lit#source');

/** WeakMap avoids retaining elements after disconnection + GC. */
const ids = new WeakMap<object, number>();
let nextId = 0;

/** Returns (and memoises) a stable numeric id for an element instance. */
export const idOf = (el: object): number => {
  let id = ids.get(el);
  if (id === undefined) {
    id = nextId++;
    ids.set(el, id);
  }
  return id;
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
