/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {expect, test} from 'vite-plus/test';
import {rampLevel} from '../../lib/runtime/timeline/flash.js';

test('one update in the window is calm', () => {
  expect(rampLevel(0)).toBe(0);
  expect(rampLevel(1)).toBe(0);
});

test('levels step up at 2, 4 and 8 updates per second', () => {
  expect(rampLevel(2)).toBe(1);
  expect(rampLevel(3)).toBe(1);
  expect(rampLevel(4)).toBe(2);
  expect(rampLevel(7)).toBe(2);
  expect(rampLevel(8)).toBe(3);
  expect(rampLevel(100)).toBe(3);
});
