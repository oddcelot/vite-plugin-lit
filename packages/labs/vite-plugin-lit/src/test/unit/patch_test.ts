/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vitest';
import {syncOwnMembers} from '../../lib/runtime/patch.js';

describe('syncOwnMembers', () => {
  test('copies new members', () => {
    const target = {};
    const source = {a: 1, greet() {}};
    syncOwnMembers(target, source, []);
    expect((target as {a: number}).a).toBe(1);
    expect(typeof (target as {greet: unknown}).greet).toBe('function');
  });

  test('deletes vanished members', () => {
    const target = {old: 1, keep: 2};
    const source = {keep: 3};
    syncOwnMembers(target, source, []);
    expect('old' in target).toBe(false);
    expect((target as {keep: number}).keep).toBe(3);
  });

  test('replaces existing values', () => {
    const target = {x: 1};
    const source = {x: 2};
    syncOwnMembers(target, source, []);
    expect((target as {x: number}).x).toBe(2);
  });

  test('honors the skip list', () => {
    const target = {constructor: 'orig', gone: 1} as object;
    const source = {};
    syncOwnMembers(target, source, ['constructor']);
    expect((target as {constructor: unknown}).constructor).toBe('orig');
    expect('gone' in target).toBe(false);
  });

  test('copies accessor descriptors as accessors', () => {
    const source = {};
    const backing = 41;
    Object.defineProperty(source, 'val', {
      get: () => backing + 1,
      configurable: true,
      enumerable: true,
    });
    const target: Record<string, unknown> = {};
    syncOwnMembers(target, source, []);
    const desc = Object.getOwnPropertyDescriptor(target, 'val')!;
    expect(typeof desc.get).toBe('function');
    expect((target as {val: number}).val).toBe(42);
  });

  test('handles symbol-keyed members', () => {
    const S = Symbol('s');
    const source = {[S]: 'hi'};
    const target = {};
    syncOwnMembers(target, source, []);
    expect((target as {[key: symbol]: unknown})[S]).toBe('hi');
  });

  test('leaves a non-configurable vanished key in place without throwing', () => {
    const target = {};
    Object.defineProperty(target, 'locked', {
      value: 1,
      configurable: false,
      enumerable: true,
    });
    const source = {};
    expect(() => syncOwnMembers(target, source, [])).not.toThrow();
    expect((target as {locked: number}).locked).toBe(1);
  });
});
