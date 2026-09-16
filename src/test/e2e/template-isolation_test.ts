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

test('editing one template leaves sibling templates and focus untouched', async () => {
  const {page, edit} = fixture;

  // Pin sibling + edit-target nodes.
  await keepShadow(page, 'list', 'hmr-siblings >> #list');
  await keepShadow(page, 'firstLi', 'hmr-siblings >> #list li');
  await keepShadow(page, 'header-h2', 'hmr-siblings >> #header h2');
  await keepShadow(page, 'host', 'hmr-siblings');

  // Focus the input, type, and set a selection.
  await page.click('hmr-siblings #text');
  await page.keyboard.type('preserved');
  await page.evaluate(() => {
    const input = document
      .querySelector('hmr-siblings')!
      .shadowRoot!.querySelector('input')!;
    input.setSelectionRange(2, 7);
  });

  await edit('src/hmr-siblings.ts', (code) =>
    code.replace('Siblings: HELLO', 'Siblings: EDITED')
  );

  await expect
    .poll(() => shadowText(page, 'hmr-siblings >> #header h2'), {
      timeout: 10_000,
    })
    .toBe('Siblings: EDITED');

  // Sibling nodes identical; edited node rebuilt.
  expect(await sameAsKept(page, 'list', 'hmr-siblings >> #list')).toBe(true);
  expect(await sameAsKept(page, 'firstLi', 'hmr-siblings >> #list li')).toBe(
    true
  );
  expect(await sameAsKept(page, 'host', 'hmr-siblings')).toBe(true);
  expect(
    await sameAsKept(page, 'header-h2', 'hmr-siblings >> #header h2')
  ).toBe(false);

  // Input keeps focus, value, and selection.
  const inputState = await page.evaluate(() => {
    const sr = document.querySelector('hmr-siblings')!.shadowRoot!;
    const input = sr.querySelector('input')!;
    return {
      focused: sr.activeElement === input,
      value: input.value,
      selection: [input.selectionStart, input.selectionEnd],
    };
  });
  expect(inputState).toEqual({
    focused: true,
    value: 'preserved',
    selection: [2, 7],
  });

  // The unrelated component never re-rendered.
  expect(await dataRenders(page, 'hmr-counter')).toBe('1');
});
