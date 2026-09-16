/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {type Fixture, keepShadow, sameAsKept, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture?.close();
});

const boxBackground = () =>
  fixture.page
    .evaluate(() => {
      const box = document
        .querySelector('hmr-styled')!
        .shadowRoot!.querySelector('#box')!;
      return getComputedStyle(box).backgroundColor;
    })
    .catch(() => null);

test('editing css restyles without DOM loss', async () => {
  const {page, edit} = fixture;

  expect(await boxBackground()).toBe('rgb(0, 128, 0)');
  await keepShadow(page, 'box', 'hmr-styled >> #box');

  await edit('src/hmr-styled.ts', (code) =>
    code.replace('rgb(0, 128, 0)', 'rgb(255, 0, 0)')
  );

  await expect.poll(boxBackground, {timeout: 10_000}).toBe('rgb(255, 0, 0)');
  expect(await sameAsKept(page, 'box', 'hmr-styled >> #box')).toBe(true);
});
