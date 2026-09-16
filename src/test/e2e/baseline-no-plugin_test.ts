/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {type Fixture, shadowText, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture({plugin: false});
});

afterAll(async () => {
  await fixture?.close();
});

test('without the plugin, an edit full-reloads and resets state', async () => {
  const {page, edit} = fixture;

  for (let i = 0; i < 3; i++) {
    await page.click('hmr-counter #increment');
  }
  await expect
    .poll(() => shadowText(page, 'hmr-counter >> #increment'))
    .toBe('Count: 3');

  await edit('src/hmr-counter.ts', (code) =>
    code.replace('Counter: HELLO', 'Counter: BASELINE')
  );

  // Vite has no HMR boundary → full page reload → fresh component state.
  // This proves the green plugin tests aren't vacuous.
  await expect
    .poll(() => shadowText(page, 'hmr-counter >> h2'), {timeout: 10_000})
    .toBe('Counter: BASELINE');
  await expect
    .poll(() => shadowText(page, 'hmr-counter >> #increment'), {
      timeout: 10_000,
    })
    .toBe('Count: 0');
});
