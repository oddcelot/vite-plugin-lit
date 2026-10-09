/**
 * Non-reactive instance state for the inspector details pane: reactive
 * controllers, `@lit/task` instances, signals and plain class fields. Runs in
 * the inspected page and reads a live element, so everything is duck-typed (no
 * dependency on the libraries) and read-only: no `run()`, no `set()`, no
 * getter on an unrecognised object, and a signal that could run user code is
 * never evaluated.
 */

import {isExpandable} from './inspect-value.js';
import {serialize, typeTag} from './serialize.js';
import {idOf} from '../timeline/identity.js';
import {isInspectable} from './collect.js';
import type {
  AnatomyElementRef,
  InspectorContext,
  InspectorExtra,
} from '../../../types/inspector.js';

/** Most extras reported for one element; keeps a field-heavy class cheap. */
const MAX_EXTRAS = 24;
const MAX_NAME = 80;
/** Consumers listed on a provider; the rest are counted. */
const MAX_CONSUMERS = 12;
/** Ancestors walked looking for a consumer's provider. */
const MAX_DEPTH = 256;

const TASK_STATUS = ['initial', 'pending', 'complete', 'error'];
const TASK_ERROR = TASK_STATUS.indexOf('error');

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
 * Preview of `read()`'s result and whether it expands, from one read: a
 * signal read inside a computed subscribes it once per read. A throwing
 * getter degrades to a placeholder instead of dropping the entry.
 */
const sample = (read: () => unknown): {value: string; expandable?: true} => {
  try {
    const v = read();
    return isExpandable(v)
      ? {value: serialize(v), expandable: true}
      : {value: serialize(v)};
  } catch {
    return {value: '[getter threw]'};
  }
};

/** `@lit/task` duck type: a controller with a numeric status, run() and render(). */
const taskStatus = (v: Dict): number | undefined => {
  if (!hasFn(v, 'run') || !hasFn(v, 'render')) return undefined;
  try {
    const status = v['status'];
    return typeof status === 'number' ? status : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Every `@lit/task` controller the element holds, with the field it is stored
 * in (else its class name). Read-only and never throws, so the lifecycle layer
 * can call it on recorded updates.
 */
export const tasksOf = (el: Element): Array<{task: object; name: string}> => {
  const out: Array<{task: object; name: string}> = [];
  try {
    const controllers = controllersOf(el);
    if (controllers.length === 0) return out;
    const host = el as unknown as Dict;
    for (const c of controllers) {
      if (taskStatus(c as Dict) === undefined) continue;
      let name: string | undefined;
      for (const key of Object.keys(host)) {
        const desc = Object.getOwnPropertyDescriptor(host, key);
        if (desc !== undefined && 'value' in desc && desc.value === c) {
          name = clip(key);
          break;
        }
      }
      out.push({task: c, name: name ?? ctorName(c)});
    }
  } catch {
    // dev tool — an unreadable element reports no tasks
  }
  return out;
};

/**
 * Every `@lit/task` controller the element holds that is currently in its
 * error state, named as by {@link tasksOf}. Read-only and never throws, so the
 * lifecycle layer can call it after each update.
 */
export const erroredTasks = (
  el: Element
): Array<{task: object; name: string; error: unknown}> => {
  const out: Array<{task: object; name: string; error: unknown}> = [];
  for (const {task, name} of tasksOf(el)) {
    if (taskStatus(task as Dict) !== TASK_ERROR) continue;
    let error: unknown;
    try {
      error = (task as Dict)['error'];
    } catch {
      error = undefined;
    }
    out.push({task, name, error});
  }
  return out;
};

const refOf = (el: Element): AnatomyElementRef => ({
  tagName: el.localName,
  ...(isInspectable(el) ? {id: idOf(el)} : {}),
});

/**
 * `@lit/context` `ContextProvider`: a `ValueNotifier` (a `subscriptions` Map
 * and `addCallback`) with a `context` key and a `host`. Same class whether
 * made directly or by `@provide`.
 */
const isProvider = (v: Dict): boolean =>
  dataProp(v, 'subscriptions')?.value instanceof Map &&
  hasFn(v, 'addCallback') &&
  hasFn(v, 'onContextRequest') &&
  dataProp(v, 'context') !== undefined;

/**
 * `ContextConsumer`: a `context` key, a `host`, boolean `subscribe` and
 * `provided` flags and `dispatchRequest`. The callback it hands to providers
 * is `_callback` in the development build but renamed in production, so it is
 * not part of the shape.
 */
const isConsumer = (v: Dict): boolean =>
  dataProp(v, 'context') !== undefined &&
  dataProp(v, 'host')?.value instanceof Element &&
  typeof dataProp(v, 'subscribe')?.value === 'boolean' &&
  typeof dataProp(v, 'provided')?.value === 'boolean' &&
  hasFn(v, 'dispatchRequest');

const contextKey = (key: unknown): string =>
  clip(
    typeof key === 'symbol' || typeof key === 'string'
      ? String(key)
      : serialize(key)
  );

/** Providers of `context` on `el` itself. */
const providersOn = (el: Element, context: unknown): Dict[] =>
  controllersOf(el).filter(
    (c) => isProvider(c as Dict) && dataProp(c, 'context')?.value === context
  ) as Dict[];

/**
 * The provider that answers a consumer, by what `ContextProvider` does with
 * the request: it bubbles (composed) from the consumer's host and the first
 * matching provider above it takes it. A subscribing consumer is confirmed
 * by its host sitting in that provider's subscriptions; a non-subscribing
 * one leaves no trace, so the nearest provider of the key stands in.
 */
const providerOf = (consumer: Dict): Element | undefined => {
  const host = dataProp(consumer, 'host')?.value;
  if (!(host instanceof Element)) return undefined;
  const context = dataProp(consumer, 'context')?.value;
  let nearest: Element | undefined;
  let el: Node | null = host;
  for (let i = 0; el !== null && i < MAX_DEPTH; i++) {
    const parent: Node | null =
      el.parentNode ?? (el instanceof ShadowRoot ? el.host : null);
    el = parent instanceof ShadowRoot ? parent.host : parent;
    if (!(el instanceof Element)) continue;
    for (const p of providersOn(el, context)) {
      const subs = dataProp(p, 'subscriptions')?.value as Map<
        unknown,
        {consumerHost?: unknown}
      >;
      for (const {consumerHost} of subs.values()) {
        if (consumerHost === host) return el;
      }
      nearest ??= el;
    }
  }
  const subscribed = dataProp(consumer, 'subscribe')?.value === true;
  return subscribed && dataProp(consumer, 'unsubscribe')?.value !== undefined
    ? undefined
    : nearest;
};

/** Context details for a provider or consumer controller; `undefined` for neither. */
const classifyContext = (
  v: Dict,
  name: string
): {extra: InspectorExtra; raw: () => unknown} | undefined => {
  const provider = isProvider(v);
  if (!provider && !isConsumer(v)) return undefined;
  const key = contextKey(dataProp(v, 'context')?.value);
  const info: InspectorContext = {
    role: provider ? 'provider' : 'consumer',
    key,
  };
  if (provider) {
    const subs = dataProp(v, 'subscriptions')?.value as Map<
      unknown,
      {consumerHost?: unknown}
    >;
    const hosts = new Set<Element>();
    for (const {consumerHost} of subs.values()) {
      if (consumerHost instanceof Element) hosts.add(consumerHost);
    }
    const all = [...hosts];
    if (all.length > 0) info.consumers = all.slice(0, MAX_CONSUMERS).map(refOf);
    if (all.length > MAX_CONSUMERS) {
      info.moreConsumers = all.length - MAX_CONSUMERS;
    }
  } else {
    const found = providerOf(v);
    if (found !== undefined) info.provider = refOf(found);
  }
  // ValueNotifier's `value` is a plain getter over `_value`; a consumer
  // stores `value` as a field.
  const raw = provider ? () => v['value'] : () => dataProp(v, 'value')?.value;
  return {
    extra: {
      kind: 'context',
      name,
      ...sample(raw),
      type: provider ? 'ContextProvider' : 'ContextConsumer',
      context: info,
    },
    raw,
  };
};

/** Classify one object the element holds; `undefined` if it is none of ours. */
/** An extra and a way to read the live value its preview shows. */
interface ExtraEntry {
  extra: InspectorExtra;
  /** The value behind the row, for expanding it; may throw. */
  raw: (() => unknown) | undefined;
}

const classify = (
  v: Dict,
  name: string,
  controller: boolean
): ExtraEntry | undefined => {
  // @lit/task: a controller with a numeric status, run() and render().
  const status = taskStatus(v);
  if (status !== undefined) {
    const raw = () => (status === TASK_ERROR ? v['error'] : v['value']);
    return {
      extra: {
        kind: 'task',
        name,
        ...sample(raw),
        type: 'Task',
        status: TASK_STATUS[status] ?? String(status),
      },
      raw,
    };
  }
  // Signals (signal-polyfill): State reads are side-effect free, but Computed
  // runs user code and lazily recomputes, so it is reported without reading.
  const ctor = ctorName(v);
  if (ctor === 'Computed' && hasFn(v, 'get')) {
    return {
      extra: {kind: 'signal', name, value: '(computed)', type: 'Computed'},
      raw: undefined,
    };
  }
  if (ctor === 'State' && hasFn(v, 'get') && hasFn(v, 'set')) {
    const raw = () => (v['get'] as () => unknown)();
    return {
      extra: {kind: 'signal', name, ...sample(raw), type: 'Signal.State'},
      raw,
    };
  }
  if (!controller) return undefined;
  const ctx = classifyContext(v, name);
  if (ctx !== undefined) return ctx;
  const held = dataProp(v, 'value');
  return {
    extra: {
      kind: 'controller',
      name,
      value: held === undefined ? ctor : serialize(held.value),
      type: ctor,
      ...(isExpandable(held === undefined ? v : held.value)
        ? {expandable: true}
        : {}),
    },
    // A controller without a value expands to its own fields.
    raw: held === undefined ? () => v : () => held.value,
  };
};

/**
 * The element's non-reactive instance state, capped at {@link MAX_EXTRAS}:
 * controllers and tasks first (in registration order), then signals and tasks
 * held in own fields, then plain own fields. Never throws.
 */
export const collectExtras = (el: Element): InspectorExtra[] =>
  collectEntries(el).map((e) => e.extra);

/**
 * The live value behind the extra named `name`, as {@link collectExtras}
 * names it, or `undefined` when there is none or it cannot be read.
 */
export const extraValue = (
  el: Element,
  name: string
): {value: unknown} | undefined => {
  const entry = collectEntries(el).find((e) => e.extra.name === name);
  if (entry?.raw === undefined) return undefined;
  try {
    return {value: entry.raw()};
  } catch {
    return undefined;
  }
};

const collectEntries = (el: Element): ExtraEntry[] => {
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

    const out: ExtraEntry[] = [];
    const listed = new Set<object>();
    const full = () => out.length >= MAX_EXTRAS;

    for (const c of controllersOf(el)) {
      if (full()) break;
      listed.add(c);
      const entry = classify(c as Dict, names.get(c) ?? ctorName(c), true);
      if (entry !== undefined) out.push(entry);
    }

    for (const [key, value] of fields) {
      if (full()) break;
      if (!isObject(value) || listed.has(value) || value instanceof Node) {
        continue;
      }
      const entry = classify(value, clip(key), false);
      if (entry !== undefined) {
        listed.add(value);
        out.push(entry);
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
        extra: {
          kind: 'field',
          name: clip(key),
          value: serialize(value),
          type: typeTag(value),
          ...(isExpandable(value) ? {expandable: true} : {}),
        },
        raw: () => value,
      });
    }
    return out;
  } catch {
    return [];
  }
};
