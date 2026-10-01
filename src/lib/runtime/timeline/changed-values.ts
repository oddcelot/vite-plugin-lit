/**
 * Old/new value previews for the properties that triggered a Lit update.
 *
 * Lit hands `update` a Map of changed key -> *old* value; the new value is
 * read off the element. Opt-in (the Changed values layer) and capped, so a
 * component with many properties cannot turn each update into a large event.
 * Runs inside the inspected page: nothing here may throw into the app.
 */

import {serialize} from '../inspector/serialize.js';
import type {ChangedValue} from '../../../types/timeline.js';

/** Most keys recorded per update; `changed` still lists every key. */
const MAX_KEYS = 16;
/** Most values `budgetedDeepEqual` visits before it gives up. */
const EQUAL_BUDGET = 200;
const EQUAL_MAX_DEPTH = 6;

/** A preview for a value `serialize` itself choked on (hostile `toString`). */
const UNREADABLE = '[unreadable]';

const preview = (value: unknown): string => {
  try {
    return serialize(value);
  } catch {
    return UNREADABLE;
  }
};

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Deep equality for values that were assigned as different references: plain
 * objects, arrays and dates are compared by content; every other object (Map,
 * Set, class instances, DOM nodes, functions) is equal only by identity.
 * Bounded by `budget` visited values and a depth of six, so a large or cyclic
 * structure ends as "not equal" rather than as work. Accessor properties are
 * never invoked: a getter makes the pair unequal.
 */
export const budgetedDeepEqual = (
  a: unknown,
  b: unknown,
  budget = EQUAL_BUDGET
): boolean => {
  let remaining = budget;

  const walk = (x: unknown, y: unknown, depth: number): boolean => {
    // Every value visited counts, primitives too: a long array of numbers is
    // as much work as a deep one.
    if (--remaining < 0) return false;
    if (Object.is(x, y)) return true;
    if (
      x === null ||
      y === null ||
      typeof x !== 'object' ||
      typeof y !== 'object'
    ) {
      return false;
    }
    if (depth > EQUAL_MAX_DEPTH) return false;

    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (!walk(x[i], y[i], depth + 1)) return false;
      }
      return true;
    }
    if (x instanceof Date) {
      return y instanceof Date && Object.is(x.getTime(), y.getTime());
    }
    if (Array.isArray(y) || !isPlainObject(x) || !isPlainObject(y)) {
      return false;
    }
    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    for (const key of keys) {
      const dx = Object.getOwnPropertyDescriptor(x, key);
      const dy = Object.getOwnPropertyDescriptor(y, key);
      if (dx === undefined || dy === undefined) return false;
      if (!('value' in dx) || !('value' in dy)) return false;
      if (!walk(dx.value, dy.value, depth + 1)) return false;
    }
    return true;
  };

  try {
    return walk(a, b, 0);
  } catch {
    // A Proxy trap or similar: treat as different.
    return false;
  }
};

/**
 * One entry per changed key (first `maxKeys`, in Map order), or `undefined`
 * when `changed` is not a non-empty Map. Never throws.
 */
export const captureChangedValues = (
  host: object,
  changed: unknown,
  maxKeys = MAX_KEYS
): ChangedValue[] | undefined => {
  try {
    if (!(changed instanceof Map) || changed.size === 0) return undefined;
    const out: ChangedValue[] = [];
    for (const [rawKey, prev] of changed) {
      if (out.length >= maxKeys) break;
      const key =
        typeof rawKey === 'symbol' ? rawKey.toString() : String(rawKey);
      let next: unknown;
      try {
        next = (host as Record<PropertyKey, unknown>)[rawKey];
      } catch {
        out.push({
          key,
          prev: preview(prev),
          next: '[getter threw]',
          sameRef: false,
          equal: false,
        });
        continue;
      }
      const sameRef = Object.is(prev, next);
      out.push({
        key,
        prev: preview(prev),
        next: preview(next),
        sameRef,
        equal: !sameRef && budgetedDeepEqual(prev, next),
      });
    }
    return out;
  } catch {
    return undefined;
  }
};
