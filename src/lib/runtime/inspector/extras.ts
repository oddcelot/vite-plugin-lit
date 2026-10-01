/**
 * Non-reactive instance state for the inspector details pane: reactive
 * controllers, `@lit/task` instances, signals and plain class fields. Runs in
 * the inspected page and reads a live element, so everything is duck-typed (no
 * dependency on the libraries) and read-only: no `run()`, no `set()`, no
 * getter on an unrecognised object, and a signal that could run user code is
 * never evaluated.
 */

import {serialize, typeTag} from './serialize.js';
import type {InspectorExtra} from '../../../types/inspector.js';

/** Most extras reported for one element; keeps a field-heavy class cheap. */
const MAX_EXTRAS = 24;
const MAX_NAME = 80;

const TASK_STATUS = ['initial', 'pending', 'complete', 'error'];

/**
 * Own fields that belong to Lit or the DOM rather than to the component. The
 * `__` and `_$` prefixes (dev and mangled production internals) are skipped by
 * prefix instead.
 */
const LIT_FIELDS = new Set([
  'renderRoot',
  'renderOptions',
  'isUpdatePending',
  'hasUpdated',
  'isConnected',
  'updateComplete',
]);

type Dict = Record<string, unknown>;

const isObject = (v: unknown): v is Dict => typeof v === 'object' && v !== null;

const clip = (s: string): string =>
  s.length > MAX_NAME ? s.slice(0, MAX_NAME) + '…' : s;

const ctorName = (v: object): string => {
  try {
    const name = (v as {constructor?: {name?: unknown}}).constructor?.name;
    return typeof name === 'string' && name !== '' ? clip(name) : 'object';
  } catch {
    return 'object';
  }
};

/**
 * `obj[key]` only when it is a data property on `obj` or its prototype chain.
 * A getter on an object we do not recognise may compute or have side effects,
 * so it is treated as absent.
 */
const dataProp = (obj: object, key: string): {value: unknown} | undefined => {
  try {
    let o: object | null = obj;
    for (let i = 0; o !== null && o !== Object.prototype && i < 16; i++) {
      const desc = Object.getOwnPropertyDescriptor(o, key);
      if (desc !== undefined) {
        return 'value' in desc ? {value: desc.value} : undefined;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
  } catch {
    // A hostile proxy; treat as absent.
  }
  return undefined;
};

const hasFn = (v: Dict, key: string): boolean => {
  try {
    return typeof v[key] === 'function';
  } catch {
    return false;
  }
};

/**
 * Lit keeps its controllers in a private `Set`: `__controllers` in the
 * development build, `_$EO` in the minified production build. There is no
 * public accessor, so a build that renames it again yields no controllers.
 */
const controllersOf = (el: Element): object[] => {
  const host = el as unknown as Dict;
  const set =
    dataProp(host, '__controllers')?.value ?? dataProp(host, '_$EO')?.value;
  if (!(set instanceof Set)) return [];
  const out: object[] = [];
  for (const c of set) {
    if (isObject(c)) out.push(c);
    if (out.length >= MAX_EXTRAS) break;
  }
  return out;
};

/**
 * Preview of `read()`'s result; a throwing getter degrades to a placeholder
 * instead of dropping the entry.
 */
const preview = (read: () => unknown): string => {
  try {
    return serialize(read());
  } catch {
    return '[getter threw]';
  }
};

/** Classify one object the element holds; `undefined` if it is none of ours. */
const classify = (
  v: Dict,
  name: string,
  controller: boolean
): InspectorExtra | undefined => {
  // @lit/task: a controller with a numeric status, run() and render().
  if (hasFn(v, 'run') && hasFn(v, 'render')) {
    let status: unknown;
    try {
      status = v['status'];
    } catch {
      status = undefined;
    }
    if (typeof status === 'number') {
      return {
        kind: 'task',
        name,
        value: preview(() => (status === 3 ? v['error'] : v['value'])),
        type: 'Task',
        status: TASK_STATUS[status] ?? String(status),
      };
    }
  }
  // Signals (signal-polyfill): State reads are side-effect free, but Computed
  // runs user code and lazily recomputes, so it is reported without reading.
  const ctor = ctorName(v);
  if (ctor === 'Computed' && hasFn(v, 'get')) {
    return {kind: 'signal', name, value: '(computed)', type: 'Computed'};
  }
  if (ctor === 'State' && hasFn(v, 'get') && hasFn(v, 'set')) {
    return {
      kind: 'signal',
      name,
      value: preview(() => (v['get'] as () => unknown)()),
      type: 'Signal.State',
    };
  }
  if (!controller) return undefined;
  const held = dataProp(v, 'value');
  return {
    kind: 'controller',
    name,
    value: held === undefined ? ctor : serialize(held.value),
    type: ctor,
  };
};

/**
 * The element's non-reactive instance state, capped at {@link MAX_EXTRAS}:
 * controllers and tasks first (in registration order), then signals and tasks
 * held in own fields, then plain own fields. Never throws.
 */
export const collectExtras = (el: Element): InspectorExtra[] => {
  try {
    const host = el as unknown as Dict;
    const declared = (
      el.constructor as {elementProperties?: Map<PropertyKey, unknown>}
    ).elementProperties;

    // Own data fields (no accessors), in definition order.
    const fields: Array<[string, unknown]> = [];
    for (const key of Object.keys(host)) {
      const desc = Object.getOwnPropertyDescriptor(host, key);
      if (desc !== undefined && 'value' in desc) fields.push([key, desc.value]);
    }

    // A controller or signal stored in a field takes the field's name.
    const names = new Map<object, string>();
    for (const [key, value] of fields) {
      if (isObject(value) && !names.has(value)) names.set(value, clip(key));
    }

    const out: InspectorExtra[] = [];
    const listed = new Set<object>();
    const full = () => out.length >= MAX_EXTRAS;

    for (const c of controllersOf(el)) {
      if (full()) break;
      listed.add(c);
      const extra = classify(c as Dict, names.get(c) ?? ctorName(c), true);
      if (extra !== undefined) out.push(extra);
    }

    for (const [key, value] of fields) {
      if (full()) break;
      if (!isObject(value) || listed.has(value) || value instanceof Node) {
        continue;
      }
      const extra = classify(value, clip(key), false);
      if (extra !== undefined) {
        listed.add(value);
        out.push(extra);
      }
    }

    for (const [key, value] of fields) {
      if (full()) break;
      if (
        key.startsWith('__') ||
        key.startsWith('_$') ||
        LIT_FIELDS.has(key) ||
        declared?.has(key) === true ||
        typeof value === 'function' ||
        (isObject(value) && (listed.has(value) || value instanceof Node))
      ) {
        continue;
      }
      out.push({
        kind: 'field',
        name: clip(key),
        value: serialize(value),
        type: typeTag(value),
      });
    }
    return out;
  } catch {
    return [];
  }
};
