/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/// <reference lib="esnext.temporal" />

import {afterAll, beforeAll, describe, expect, test, vi} from 'vite-plus/test';
import {serialize, typeTag} from '../../lib/runtime/inspector/serialize.js';

// The serializer checks `instanceof Node` for DOM previews; the unit project
// runs in plain Node, which has no DOM.
beforeAll(() => vi.stubGlobal('Node', class {}));
afterAll(() => vi.unstubAllGlobals());

describe('Temporal values', () => {
  const cases = [
    [
      Temporal.Instant.from('2026-09-29T07:00:00Z'),
      'Temporal.Instant',
      'Temporal.Instant(2026-09-29T07:00:00Z)',
    ],
    [
      Temporal.PlainDate.from('2026-09-29'),
      'Temporal.PlainDate',
      'Temporal.PlainDate(2026-09-29)',
    ],
    [
      Temporal.ZonedDateTime.from('2026-09-29T09:00:00+02:00[Europe/Vienna]'),
      'Temporal.ZonedDateTime',
      'Temporal.ZonedDateTime(2026-09-29T09:00:00+02:00[Europe/Vienna])',
    ],
    [
      Temporal.Duration.from({minutes: 5}),
      'Temporal.Duration',
      'Temporal.Duration(PT5M)',
    ],
  ] as const;

  test.each(cases)(
    '%s previews with its kind and ISO form',
    (value, tag, preview) => {
      expect(typeTag(value)).toBe(tag);
      expect(serialize(value)).toBe(preview);
    }
  );

  test('nested Temporal values preview inside objects', () => {
    const value = {due: Temporal.PlainDate.from('2026-10-01')};
    expect(serialize(value)).toBe('{due: Temporal.PlainDate(2026-10-01)}');
  });

  test('recognises polyfilled values by their toStringTag', () => {
    // What a polyfill's Instant looks like to the serializer on a page with
    // no native Temporal: a class instance tagged per the spec.
    class Instant {
      get [Symbol.toStringTag]() {
        return 'Temporal.Instant';
      }
      toString() {
        return '2026-09-29T07:00:00Z';
      }
    }
    expect(typeTag(new Instant())).toBe('Temporal.Instant');
    expect(serialize(new Instant())).toBe(
      'Temporal.Instant(2026-09-29T07:00:00Z)'
    );
  });

  test('Date previews are unchanged', () => {
    expect(serialize(new Date('2026-09-29T07:00:00Z'))).toBe(
      '2026-09-29T07:00:00.000Z'
    );
  });
});

describe('primitives', () => {
  test.each([
    [null, 'null'],
    [undefined, 'undefined'],
    [42, '42'],
    [true, 'true'],
    [10n, '10n'],
    ['hi', '"hi"'],
    [Symbol('s'), 'Symbol(s)'],
  ] as const)('%s previews as %s', (value, preview) => {
    expect(serialize(value)).toBe(preview);
  });

  test('long strings are truncated at 120 characters', () => {
    expect(serialize('x'.repeat(200))).toBe(`"${'x'.repeat(120)}…"`);
  });
});

describe('functions', () => {
  test('named and anonymous functions', () => {
    function named() {}
    expect(serialize(named)).toBe('ƒ named()');
    expect(serialize(() => {})).toBe('ƒ ()');
    expect(typeTag(named)).toBe('function');
  });
});

describe('arrays and objects', () => {
  test('previews arrays and plain objects', () => {
    expect(serialize([1, 'a', null])).toBe('[1, "a", null]');
    expect(serialize({a: 1, b: 'x'})).toBe('{a: 1, b: "x"}');
  });

  test('class instances are prefixed with their constructor name', () => {
    class Point {
      x = 1;
    }
    expect(serialize(new Point())).toBe('Point {x: 1}');
    expect(typeTag(new Point())).toBe('Point');
  });

  test('shows at most 8 items and counts the rest', () => {
    expect(serialize(Array.from({length: 10}, (_, i) => i))).toBe(
      '[0, 1, 2, 3, 4, 5, 6, 7, …+2]'
    );
    const wide = Object.fromEntries(
      Array.from({length: 9}, (_, i) => [`k${i}`, i])
    );
    expect(serialize(wide)).toContain(', …+1}');
  });

  test('a throwing getter degrades to a placeholder', () => {
    const value = {
      ok: 1,
      get bad(): number {
        throw new Error('x');
      },
    };
    expect(serialize(value)).toBe('{ok: 1, bad: [getter threw]}');
  });

  test('typed arrays show their length and first items', () => {
    expect(serialize(new Uint8Array([1, 2, 3]))).toBe(
      'Uint8Array(3) [1, 2, 3]'
    );
    expect(serialize(new Uint8Array(10))).toBe(
      'Uint8Array(10) [0, 0, 0, 0, 0, 0, 0, 0, …+2]'
    );
  });

  test('type tags for arrays and plain objects', () => {
    expect(typeTag([1, 2])).toBe('Array(2)');
    expect(typeTag({})).toBe('object');
    expect(typeTag(null)).toBe('null');
    expect(typeTag(1)).toBe('number');
  });
});

describe('collections and built-ins', () => {
  test('Map and Set show only their size', () => {
    expect(serialize(new Map([[1, 2]]))).toBe('Map(1)');
    expect(serialize(new Set([1, 2]))).toBe('Set(2)');
    expect(typeTag(new Map())).toBe('Map(0)');
    expect(typeTag(new Set([1]))).toBe('Set(1)');
  });

  test('RegExp previews as its literal', () => {
    expect(serialize(/a+/g)).toBe('/a+/g');
  });
});

describe('circular references and depth', () => {
  test('a self-reference previews as [Circular]', () => {
    const value: Record<string, unknown> = {a: 1};
    value.self = value;
    expect(serialize(value)).toBe('{a: 1, self: [Circular]}');
  });

  test('a repeated non-circular reference is not flagged', () => {
    const shared = {n: 1};
    expect(serialize({a: shared, b: shared})).toBe('{a: {n: 1}, b: {n: 1}}');
  });

  test('nesting beyond two levels collapses to a type label', () => {
    expect(serialize({a: {b: {c: {d: 1}}}})).toBe('{a: {b: object}}');
    expect(serialize({a: {b: [1, 2, 3]}})).toBe('{a: {b: Array(3)}}');
  });
});

describe('DOM nodes', () => {
  // Minimal stand-ins: the serializer only reads id, tagName and nodeName.
  class FakeNode {
    constructor(public nodeName: string) {}
  }
  class FakeElement extends FakeNode {
    constructor(
      public tagName: string,
      public id = ''
    ) {
      super(tagName);
    }
  }

  beforeAll(() => {
    vi.stubGlobal('Node', FakeNode);
    vi.stubGlobal('Element', FakeElement);
  });

  test('elements preview as a tag with an optional id', () => {
    expect(serialize(new FakeElement('DIV', 'main'))).toBe('<div#main>');
    expect(serialize(new FakeElement('SPAN'))).toBe('<span>');
  });

  test('other nodes preview by node name', () => {
    expect(serialize(new FakeNode('#TEXT'))).toBe('##text');
  });

  test('typeTag labels any node as Node', () => {
    expect(typeTag(new FakeElement('DIV'))).toBe('Node');
  });
});
