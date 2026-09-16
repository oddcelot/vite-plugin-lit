/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vitest';
import {intern, wrapTag} from '../../lib/runtime/intern.js';

// Produces a genuine TemplateStringsArray with fresh identity per call,
// like a re-executed module does.
const tsa = (...parts: string[]): TemplateStringsArray => {
  const make = new Function('t', `return t\`${parts.join('${0}')}\`;`) as (
    t: (s: TemplateStringsArray, ...v: unknown[]) => TemplateStringsArray
  ) => TemplateStringsArray;
  return make((s) => s);
};

describe('intern', () => {
  test('same content and namespace yields the same canonical array', () => {
    const a = tsa('<p>', '</p>');
    const b = tsa('<p>', '</p>');
    expect(a).not.toBe(b);
    expect(intern('html', a)).toBe(intern('html', b));
  });

  test('first-seen array becomes the canonical one', () => {
    const a = tsa('<em>first</em>');
    expect(intern('html', a)).toBe(a);
    expect(intern('html', tsa('<em>first</em>'))).toBe(a);
  });

  test('different namespaces do not share canonical arrays', () => {
    const a = tsa('<rect/>');
    const b = tsa('<rect/>');
    expect(intern('html', a)).not.toBe(intern('svg', b));
  });

  test('different raw content yields different canonical arrays', () => {
    expect(intern('html', tsa('<p>a</p>'))).not.toBe(
      intern('html', tsa('<p>b</p>'))
    );
  });

  test('chunk boundaries are unambiguous', () => {
    // Same concatenated content, different chunking must not collide.
    const a = tsa('ab', 'c');
    const b = tsa('a', 'bc');
    expect(intern('html', a)).not.toBe(intern('html', b));
  });

  test('non-TemplateStringsArray input passes through untouched', () => {
    const notTsa = ['<p>', '</p>'] as unknown as TemplateStringsArray;
    expect(intern('html', notTsa)).toBe(notTsa);
    const noRawArray = Object.assign(['x'], {
      raw: 'x',
    }) as unknown as TemplateStringsArray;
    expect(intern('html', noRawArray)).toBe(noRawArray);
  });

  test('repeated lookups hit the WeakMap fast path', () => {
    const a = tsa('fast', 'path');
    const first = intern('html', a);
    expect(intern('html', a)).toBe(first);
  });
});

describe('wrapTag', () => {
  test('wrapped tag receives the canonical strings array', () => {
    const seen: TemplateStringsArray[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.push(strings);
      return {strings, values};
    };
    const wrapped = wrapTag(tag, 'html');

    const a = tsa('<b>', '</b>');
    const b = tsa('<b>', '</b>');
    const first = wrapped(a, 1) as {strings: TemplateStringsArray};
    const second = wrapped(b, 2) as {strings: TemplateStringsArray};

    expect(first.strings).toBe(second.strings);
    expect(seen[0]).toBe(seen[1]);
  });

  test('wrapped tag forwards values and result', () => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    });
    const wrapped = wrapTag(tag, 'html');
    const result = wrapped(tsa('a', 'b'), 1, 2) as {values: unknown[]};
    expect(result.values).toEqual([1, 2]);
  });
});
