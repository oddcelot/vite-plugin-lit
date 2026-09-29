/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vite-plus/test';
import type {TimelineSpan} from '../../lib/timeline/derive.js';
import {
  compileRegex,
  filterSpans,
  listElements,
  spanHaystack,
} from '../../lib/timeline/filter.js';
import type {TimelineEvent} from '../../types/timeline.js';

const span = (over: Partial<TimelineSpan>): TimelineSpan => ({
  layerId: 'lit-lifecycle',
  key: 'k',
  name: 'update',
  start: 0,
  events: [],
  ...over,
});

const spans: TimelineSpan[] = [
  span({key: 'a', name: 'performUpdate', meta: {elementId: 1, tagName: 'x-a'}}),
  span({
    key: 'b',
    name: 'click',
    subtitle: 'button',
    meta: {elementId: 2, tagName: 'x-b'},
  }),
  span({key: 'c', name: 'update', changed: ['count'], meta: {elementId: 2}}),
];

describe('compileRegex', () => {
  test('empty matches everything and is valid', () => {
    expect(compileRegex('')).toEqual({re: null, invalid: false});
  });
  test('compiles case-insensitively', () => {
    expect(compileRegex('UPD').re?.test('performupdate')).toBe(true);
  });
  test('an uncompilable pattern is invalid and filters nothing', () => {
    expect(compileRegex('foo(')).toEqual({re: null, invalid: true});
  });
});

describe('spanHaystack', () => {
  test('joins tag, name, subtitle and changed keys', () => {
    expect(spanHaystack(spans[2]!)).toContain('count');
    expect(spanHaystack(spans[1]!)).toContain('x-b');
    expect(spanHaystack(spans[1]!)).toContain('button');
  });
});

describe('filterSpans', () => {
  const keys = (r: TimelineSpan[]) => r.map((s) => s.key);
  test('no filter keeps everything', () => {
    expect(keys(filterSpans(spans, null, null))).toEqual(['a', 'b', 'c']);
  });
  test('element filter keeps that element only', () => {
    expect(keys(filterSpans(spans, 2, null))).toEqual(['b', 'c']);
  });
  test('regex matches tag, subtitle and changed keys', () => {
    expect(keys(filterSpans(spans, null, /x-a/i))).toEqual(['a']);
    expect(keys(filterSpans(spans, null, /button/i))).toEqual(['b']);
    expect(keys(filterSpans(spans, null, /count/i))).toEqual(['c']);
  });
  test('both filters combine', () => {
    expect(keys(filterSpans(spans, 2, /update/i))).toEqual(['c']);
  });
});

describe('listElements', () => {
  test('returns distinct elements in first-seen order', () => {
    const ev = (id: number, tagName?: string) =>
      ({
        layerId: 'l',
        time: 0,
        meta: {elementId: id, tagName},
      }) as TimelineEvent;
    expect(listElements([ev(1, 'x-a'), ev(2), ev(1, 'x-a')])).toEqual([
      {id: 1, tag: 'x-a'},
      {id: 2, tag: 'unknown'},
    ]);
  });
});
