/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vite-plus/test';
import {
  changedKeys,
  elementById,
  idOf,
  sourceOf,
} from '../../lib/runtime/timeline/identity.js';

describe('changedKeys', () => {
  test('lists the keys of a Map in insertion order', () => {
    expect(
      changedKeys(
        new Map([
          ['a', 1],
          ['b', 2],
        ])
      )
    ).toEqual(['a', 'b']);
  });

  test('returns an empty list for an empty Map', () => {
    expect(changedKeys(new Map())).toEqual([]);
  });

  test('stringifies symbol keys and coerces other keys', () => {
    const keys = changedKeys(
      new Map<unknown, unknown>([
        [Symbol('s'), 1],
        [7, 2],
      ])
    );
    expect(keys).toEqual(['Symbol(s)', '7']);
  });

  test.each([undefined, null, {}, ['a'], new Set(['a']), 'a'])(
    'returns undefined for a non-Map (%j)',
    (value) => {
      expect(changedKeys(value)).toBeUndefined();
    }
  );
});

describe('idOf and elementById', () => {
  test('is stable for one object and distinct across objects', () => {
    const a = {};
    const b = {};
    expect(idOf(a)).toBe(idOf(a));
    expect(idOf(a)).not.toBe(idOf(b));
  });

  test('hands out increasing ids', () => {
    const first = idOf({});
    const second = idOf({});
    expect(second).toBeGreaterThan(first);
  });

  test('elementById returns the same instance for an id', () => {
    const el = {};
    expect(elementById(idOf(el))).toBe(el);
  });

  test('elementById is undefined for an id never handed out', () => {
    expect(elementById(-1)).toBeUndefined();
  });
});

describe('sourceOf', () => {
  const META = Symbol.for('@lit-labs/vite-plugin-lit#source');
  const withMeta = (meta: unknown) => {
    class El {}
    (El as unknown as Record<symbol, unknown>)[META] = meta;
    return new El();
  };

  test('reads file and line from the constructor metadata', () => {
    expect(sourceOf(withMeta({filePath: '/a.ts', lineNumber: 12}))).toEqual({
      file: '/a.ts',
      line: 12,
    });
  });

  test('defaults the line to 1', () => {
    expect(sourceOf(withMeta({filePath: '/a.ts'}))).toEqual({
      file: '/a.ts',
      line: 1,
    });
  });

  test('is undefined without metadata or a file path', () => {
    expect(sourceOf({})).toBeUndefined();
    expect(sourceOf(withMeta({lineNumber: 3}))).toBeUndefined();
  });

  test('is undefined for an object with no constructor', () => {
    expect(sourceOf(Object.create(null))).toBeUndefined();
  });
});
