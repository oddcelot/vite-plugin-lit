/**
 * Compact, depth- and breadth-limited previews of arbitrary property values
 * for the inspector details pane. Values cross the transport as plain strings,
 * so this never needs to round-trip — it only has to be readable and safe
 * (circular refs, DOM nodes, functions, huge collections all handled).
 */

const MAX_DEPTH = 2;
const MAX_ITEMS = 8;
const MAX_STRING = 120;

/**
 * `'Temporal.Instant'`, `'Temporal.PlainDate'`, … for a Temporal value, else
 * `undefined`. Reads the spec's `Symbol.toStringTag` rather than touching the
 * `Temporal` global, so it works on pages without native Temporal (Safari,
 * at the time of writing) and with polyfilled values alike.
 */
const temporalTag = (value: object): string | undefined => {
  const tag = (value as {[Symbol.toStringTag]?: unknown})[Symbol.toStringTag];
  return typeof tag === 'string' && tag.startsWith('Temporal.')
    ? tag
    : undefined;
};

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
  const temporal = temporalTag(value as object);
  if (temporal !== undefined) return temporal;
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

/** Primitives and functions; `undefined` for anything object-like. */
const serializeScalar = (value: unknown): string | undefined => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  // Narrow on `value` rather than a saved `typeof`: the compiler cannot carry
  // a discriminant through a separate variable.
  if (typeof value === 'string') return JSON.stringify(truncate(value));
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') {
    const name = (value as {name?: string}).name;
    return name ? `ƒ ${name}()` : 'ƒ ()';
  }
  return undefined;
};

/**
 * Objects with a fixed one-line form that never recurse (DOM nodes, dates,
 * Temporal values, regular expressions); `undefined` for any other object.
 */
const serializeAtom = (obj: object): string | undefined => {
  if (obj instanceof Node) return previewNode(obj);
  if (obj instanceof Date) return obj.toISOString();
  // Temporal objects have no own enumerable fields, so the generic object
  // branch would show `{}`. Their `toString()` is the ISO form.
  const temporal = temporalTag(obj);
  if (temporal !== undefined) {
    return `${temporal}(${(obj as {toString(): string}).toString()})`;
  }
  if (obj instanceof RegExp) return String(obj);
  return undefined;
};

/** Whether `value` is an indexable typed array (a `DataView` is not). */
const isTypedArray = (value: object): boolean =>
  ArrayBuffer.isView(value) && !(value instanceof DataView);

// Typed arrays are indexable but not `Array.isArray`; routing them through
// the generic object branch would make `Object.keys` materialize every index
// (e.g. a million-element Uint8Array) before slicing. Handle them as arrays.
const serializeTypedArray = (obj: object): string => {
  const arr = obj as unknown as {length: number; [i: number]: number};
  const shown = Math.min(arr.length, MAX_ITEMS);
  const items: string[] = [];
  for (let i = 0; i < shown; i++) items.push(String(arr[i]));
  if (arr.length > MAX_ITEMS) items.push(`…+${arr.length - MAX_ITEMS}`);
  return `${obj.constructor?.name ?? 'TypedArray'}(${arr.length}) [${items.join(', ')}]`;
};

// Map and Set list their first entries like an array does, after the size the
// depth-limited form shows: `Map(2) {"a" => 1, "b" => 2}`.
const serializeCollection = (
  collection: Map<unknown, unknown> | Set<unknown>,
  depth: number,
  seen: WeakSet<object>
): string => {
  const isMap = collection instanceof Map;
  const items: string[] = [];
  for (const entry of isMap ? collection : collection.values()) {
    if (items.length === MAX_ITEMS) break;
    if (isMap) {
      const [k, v] = entry as [unknown, unknown];
      items.push(
        `${serializeAt(k, depth + 1, seen)} => ${serializeAt(v, depth + 1, seen)}`
      );
    } else {
      items.push(serializeAt(entry, depth + 1, seen));
    }
  }
  if (collection.size > MAX_ITEMS) {
    items.push(`…+${collection.size - MAX_ITEMS}`);
  }
  const tag = `${isMap ? 'Map' : 'Set'}(${collection.size})`;
  return items.length === 0 ? tag : `${tag} {${items.join(', ')}}`;
};

const serializeArray = (
  arr: unknown[],
  depth: number,
  seen: WeakSet<object>
): string => {
  const items = arr
    .slice(0, MAX_ITEMS)
    .map((v) => serializeAt(v, depth + 1, seen));
  if (arr.length > MAX_ITEMS) items.push(`…+${arr.length - MAX_ITEMS}`);
  return `[${items.join(', ')}]`;
};

// Read each property individually (keys, not entries) so a single throwing
// getter degrades to a placeholder instead of aborting the whole preview.
const serializeObject = (
  obj: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>
): string => {
  const keys = Object.keys(obj);
  const parts = keys.slice(0, MAX_ITEMS).map((k) => {
    let v: unknown;
    try {
      v = obj[k];
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
};

/** The recursive kinds: collections, arrays and everything else. */
const serializeContainer = (
  obj: object,
  depth: number,
  seen: WeakSet<object>
): string => {
  if (obj instanceof Map || obj instanceof Set) {
    return serializeCollection(obj, depth, seen);
  }
  if (Array.isArray(obj)) return serializeArray(obj, depth, seen);
  return serializeObject(obj as Record<string, unknown>, depth, seen);
};

const serializeAt = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): string => {
  const scalar = serializeScalar(value);
  if (scalar !== undefined) return scalar;

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';

  const atom = serializeAtom(obj);
  if (atom !== undefined) return atom;
  if (depth >= MAX_DEPTH) {
    return Array.isArray(obj) ? `Array(${obj.length})` : typeTag(obj);
  }
  if (isTypedArray(obj)) return serializeTypedArray(obj);

  seen.add(obj);
  try {
    return serializeContainer(obj, depth, seen);
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
