/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Template-strings interning.
 *
 * lit-html keys its template cache by the object identity of the
 * `TemplateStringsArray`, so when Vite HMR re-executes a module, every
 * template literal produces a fresh array and lit rebuilds the entire DOM
 * subtree. Interning canonicalizes strings arrays by content: unchanged
 * templates keep their identity across re-execution, so only the edited
 * template rebuilds its part.
 *
 * This module is dependency-free and must stay safe to load in any
 * environment (it is injected into user modules in dev).
 */

interface InternState {
  /** Content key → the canonical (first-seen) strings array. */
  byContent: Map<string, TemplateStringsArray>;
  /**
   * Fast path: per-call-site arrays recur on every render, so after the
   * first lookup we can map them to their canonical array with a single
   * WeakMap hit instead of rebuilding the content key.
   */
  canonicalOf: WeakMap<TemplateStringsArray, TemplateStringsArray>;
}

// Exactly one intern state per page, even if this module is loaded twice
// (e.g. via both an optimized and a raw URL).
const STATE_KEY = Symbol.for('@lit-labs/vite-plugin-lit#intern');

const getState = (): InternState => {
  const g = globalThis as unknown as Record<symbol, InternState | undefined>;
  return (g[STATE_KEY] ??= {
    byContent: new Map(),
    canonicalOf: new WeakMap(),
  });
};

/**
 * Builds a collision-free content key for a strings array.
 *
 * Uses the `raw` chunks (cooked strings derive from raw) with length
 * prefixes so that chunk boundaries can never collide, namespaced per tag
 * type: `html` and `svg` templates with equal content must not share a
 * canonical array, or one shared `Template` would parse SVG as HTML.
 */
const contentKey = (ns: string, raw: readonly string[]): string => {
  let key = ns + '\x00' + raw.length;
  for (const chunk of raw) {
    key += '\x01' + chunk.length + '\x01' + chunk;
  }
  return key;
};

/**
 * Returns the canonical strings array for `strings` within namespace `ns`.
 *
 * The first genuine `TemplateStringsArray` seen for a given content becomes
 * the canonical array; later content-equal arrays map onto it. Non-template
 * input (anything without a `raw` array) passes through untouched so lit
 * can raise its own error.
 */
export const intern = (
  ns: string,
  strings: TemplateStringsArray
): TemplateStringsArray => {
  if (
    !Array.isArray(strings) ||
    !Array.isArray((strings as {raw?: unknown}).raw)
  ) {
    return strings;
  }
  const state = getState();
  const fast = state.canonicalOf.get(strings);
  if (fast !== undefined) {
    return fast;
  }
  const key = contentKey(ns, strings.raw);
  let canonical = state.byContent.get(key);
  if (canonical === undefined) {
    canonical = strings;
    state.byContent.set(key, canonical);
  }
  state.canonicalOf.set(strings, canonical);
  return canonical;
};

/**
 * Wraps a template tag so its strings argument is interned in `ns`.
 */
export const wrapTag = <
  T extends (strings: TemplateStringsArray, ...values: never[]) => unknown,
>(
  tag: T,
  ns: string
): T =>
  ((strings: TemplateStringsArray, ...values: never[]) =>
    tag(intern(ns, strings), ...values)) as T;
