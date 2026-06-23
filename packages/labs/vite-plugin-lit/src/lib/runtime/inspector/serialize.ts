/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Compact, depth- and breadth-limited previews of arbitrary property values
 * for the inspector details pane. Values cross the transport as plain strings,
 * so this never needs to round-trip — it only has to be readable and safe
 * (circular refs, DOM nodes, functions, huge collections all handled).
 */

const MAX_DEPTH = 2;
const MAX_ITEMS = 8;
const MAX_STRING = 120;

/** A short type label for the details table's "type" column. */
export const typeTag = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array(${value.length})`;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return t;
  if (t === 'function') return 'function';
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (value instanceof Node) return 'Node';
  const name = (value as object).constructor?.name;
  return name !== undefined && name !== 'Object' ? name : 'object';
};

const truncate = (s: string): string =>
  s.length > MAX_STRING ? s.slice(0, MAX_STRING) + '…' : s;

const previewNode = (node: Node): string => {
  if (node instanceof Element) {
    const id = node.id ? `#${node.id}` : '';
    return `<${node.tagName.toLowerCase()}${id}>`;
  }
  return `#${node.nodeName.toLowerCase()}`;
};

const serializeAt = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const t = typeof value;
  if (t === 'string') return JSON.stringify(truncate(value as string));
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'bigint') return `${value}n`;
  if (t === 'symbol') return (value as symbol).toString();
  if (t === 'function') {
    const name = (value as {name?: string}).name;
    return name ? `ƒ ${name}()` : 'ƒ ()';
  }

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';

  if (value instanceof Node) return previewNode(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;

  if (depth >= MAX_DEPTH) {
    return Array.isArray(value) ? `Array(${value.length})` : typeTag(value);
  }

  // Typed arrays are indexable but not `Array.isArray`; routing them through
  // the generic object branch would make `Object.keys` materialize every index
  // (e.g. a million-element Uint8Array) before slicing. Handle them as arrays.
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const arr = value as unknown as {length: number; [i: number]: number};
    const shown = Math.min(arr.length, MAX_ITEMS);
    const items: string[] = [];
    for (let i = 0; i < shown; i++) items.push(String(arr[i]));
    if (arr.length > MAX_ITEMS) items.push(`…+${arr.length - MAX_ITEMS}`);
    return `${obj.constructor?.name ?? 'TypedArray'}(${arr.length}) [${items.join(', ')}]`;
  }

  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ITEMS)
        .map((v) => serializeAt(v, depth + 1, seen));
      if (value.length > MAX_ITEMS) items.push(`…+${value.length - MAX_ITEMS}`);
      return `[${items.join(', ')}]`;
    }
    // Read each property individually (keys, not entries) so a single throwing
    // getter degrades to a placeholder instead of aborting the whole preview.
    const keys = Object.keys(value as Record<string, unknown>);
    const parts = keys.slice(0, MAX_ITEMS).map((k) => {
      let v: unknown;
      try {
        v = (value as Record<string, unknown>)[k];
      } catch {
        return `${k}: [getter threw]`;
      }
      return `${k}: ${serializeAt(v, depth + 1, seen)}`;
    });
    if (keys.length > MAX_ITEMS) {
      parts.push(`…+${keys.length - MAX_ITEMS}`);
    }
    const name = obj.constructor?.name;
    const prefix = name !== undefined && name !== 'Object' ? `${name} ` : '';
    return `${prefix}{${parts.join(', ')}}`;
  } finally {
    seen.delete(obj);
  }
};

/** Produce a readable one-line preview of `value`. Never throws. */
export const serialize = (value: unknown): string => {
  try {
    return serializeAt(value, 0, new WeakSet());
  } catch {
    return '[unserializable]';
  }
};
