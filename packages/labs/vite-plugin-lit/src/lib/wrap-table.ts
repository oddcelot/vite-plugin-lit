/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The exact wrap surface: which template-tag exports of which lit-family
 * module specifiers get interned, and in which namespace.
 *
 * Namespaces are per tag *type*, not per module — `html` from `'lit'` and
 * from `'lit-html'` feed the same lit-html template cache, so they must
 * share canonical arrays. But content-equal `html` and `svg` templates must
 * never share one (a shared Template would parse SVG as HTML), and the
 * static-html tags pass zero-statics calls straight through to lit-html, so
 * they get their own namespaces too.
 *
 * Specifiers must be valid export-map subpaths (e.g. `lit/index.js` and
 * `lit-html/lit-html.js` are not, and are deliberately absent).
 */

export interface WrappedTag {
  readonly exportName: 'html' | 'svg' | 'mathml' | 'css';
  readonly ns: string;
}

const tags = (...names: Array<WrappedTag['exportName']>): WrappedTag[] =>
  names.map((exportName) => ({exportName, ns: exportName}));

const staticTags = (...names: Array<WrappedTag['exportName']>): WrappedTag[] =>
  names.map((exportName) => ({exportName, ns: `static-${exportName}`}));

export const WRAP_TABLE: ReadonlyMap<string, readonly WrappedTag[]> = new Map([
  ['lit', tags('html', 'svg', 'mathml', 'css')],
  ['lit/html.js', tags('html', 'svg', 'mathml')],
  ['lit/static-html.js', staticTags('html', 'svg', 'mathml')],
  ['lit-html', tags('html', 'svg', 'mathml')],
  ['lit-html/static.js', staticTags('html', 'svg', 'mathml')],
  ['lit-element', tags('html', 'svg', 'mathml', 'css')],
  ['lit-element/lit-element.js', tags('html', 'svg', 'mathml', 'css')],
  ['@lit/reactive-element', tags('css')],
  ['@lit/reactive-element/css-tag.js', tags('css')],
  // The signals tags wrap the user's values but pass the strings array
  // straight through to lit-html's core tags, so they intern in the same
  // namespaces as plain html/svg (content-equal templates share a cache
  // entry either way).
  ['@lit-labs/signals', tags('html', 'svg')],
]);
