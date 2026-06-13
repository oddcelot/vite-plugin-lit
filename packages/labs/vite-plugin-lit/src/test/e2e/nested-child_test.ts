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

test('child element identity and @state survive a parent-template edit', async () => {
  const {page, edit} = fixture;

  await page.click('hmr-child #child-increment');
  await page.click('hmr-child #child-increment');
  await expect
    .poll(() => shadowText(page, 'hmr-parent >> hmr-child >> #child-increment'))
    .toBe('Child count: 2');
  const childRenders = await dataRenders(page, 'hmr-parent >> hmr-child');
  await keepShadow(page, 'child', 'hmr-parent >> #child');

  await edit('src/hmr-parent.ts', (code) =>
    code.replace('Parent: ONE', 'Parent: TWO')
  );

  await expect
    .poll(() => shadowText(page, 'hmr-parent >> #title'), {timeout: 10_000})
    .toBe('Parent: TWO');

  expect(await sameAsKept(page, 'child', 'hmr-parent >> #child')).toBe(true);
  expect(
    await shadowText(page, 'hmr-parent >> hmr-child >> #child-increment')
  ).toBe('Child count: 2');
  // The child never re-rendered.
  expect(await dataRenders(page, 'hmr-parent >> hmr-child')).toBe(childRenders);
});
