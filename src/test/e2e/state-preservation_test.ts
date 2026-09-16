/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {
  type Fixture,
  dataRenders,
  keepShadow,
  sameAsKept,
  shadowText,
  startFixture,
} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture?.close();
});

test('@state survives an edit to the component template', async () => {
  const {page, edit} = fixture;

  for (let i = 0; i < 3; i++) {
    await page.click('hmr-counter #increment');
  }
  await expect
    .poll(() => shadowText(page, 'hmr-counter >> #increment'))
    .toBe('Count: 3');
  expect(await dataRenders(page, 'hmr-counter')).toBe('4');
  await keepShadow(page, 'host', 'hmr-counter');

  await edit('src/hmr-counter.ts', (code) =>
    code.replace('Count: ${this.count}', 'Tally: ${this.count}')
  );

  // The count survives the patch — this also proves the snapshot/restore
  // step (published prod lit would otherwise reset state, since accessor
  // storage keys are fresh Symbol()s per class evaluation).
  await expect
    .poll(() => shadowText(page, 'hmr-counter >> #increment'), {
      timeout: 10_000,
    })
    .toBe('Tally: 3');

  expect(await sameAsKept(page, 'host', 'hmr-counter')).toBe(true);
  // Re-rendered exactly once for the patch.
  expect(await dataRenders(page, 'hmr-counter')).toBe('5');
});
