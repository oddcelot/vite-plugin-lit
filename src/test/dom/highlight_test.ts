/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterEach, beforeEach, describe, expect, test} from 'vite-plus/test';
import {
  clearHighlight,
  highlightById,
  showHighlight,
} from '../../lib/runtime/inspector/highlight.js';
import {idOf} from '../../lib/runtime/timeline/identity.js';

const rectOf = (
  el: Element,
  r: {l: number; t: number; w: number; h: number}
) => {
  el.getBoundingClientRect = () =>
    ({left: r.l, top: r.t, width: r.w, height: r.h}) as DOMRect;
};

const box = () =>
  document.querySelector<HTMLElement>('[data-lit-devtools-highlight]');

let target: HTMLElement;

beforeEach(() => {
  target = document.createElement('div');
  rectOf(target, {l: 10, t: 20, w: 100, h: 50});
  document.body.append(target);
});

afterEach(() => {
  // Hide rather than remove: the module caches its box.
  clearHighlight();
  target.remove();
});

describe('showHighlight', () => {
  test('lays a fixed, click-through box over the element rect', () => {
    showHighlight(target);
    const el = box()!;
    expect(el.style.display).toBe('block');
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('50px');
    expect(el.style.position).toBe('fixed');
    expect(el.style.pointerEvents).toBe('none');
  });

  test('reuses one box and follows the next element', () => {
    showHighlight(target);
    const other = document.createElement('div');
    rectOf(other, {l: 1, t: 2, w: 3, h: 4});
    document.body.append(other);
    showHighlight(other);
    expect(
      document.querySelectorAll('[data-lit-devtools-highlight]')
    ).toHaveLength(1);
    expect(box()!.style.left).toBe('1px');
    expect(box()!.style.height).toBe('4px');
    other.remove();
  });
});

describe('clearHighlight', () => {
  test('is safe before any box exists and hides it afterwards', () => {
    expect(() => clearHighlight()).not.toThrow();
    showHighlight(target);
    clearHighlight();
    expect(box()!.style.display).toBe('none');
  });
});

describe('highlightById', () => {
  test('outlines the element with that id', () => {
    highlightById(idOf(target));
    expect(box()!.style.display).toBe('block');
    expect(box()!.style.width).toBe('100px');
  });

  test('clears for null', () => {
    highlightById(idOf(target));
    highlightById(null);
    expect(box()!.style.display).toBe('none');
  });

  test('clears when the id does not resolve', () => {
    highlightById(idOf(target));
    highlightById(987654321);
    expect(box()!.style.display).toBe('none');
  });
});
