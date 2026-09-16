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

test('@property and array/object @state survive; accessors stay live', async () => {
  const {page, edit} = fixture;

  // Build up state: two items, a dark color scheme, an externally-assigned
  // reflected property, and a numeric property.
  await page.click('hmr-properties #add-item');
  await page.click('hmr-properties #add-item');
  // Pin the OS preference to light so the toggle (which flips the *resolved*
  // scheme) deterministically lands on dark from the `auto` default.
  await page.emulateMedia({colorScheme: 'light'});
  await page.click('hmr-properties #toggle-color-scheme');
  await page.evaluate(() => {
    const el = document.querySelector('hmr-properties') as HTMLElement & {
      label: string;
      factor: number;
    };
    el.label = 'assigned';
    el.factor = 7;
  });
  await expect
    .poll(() => shadowText(page, 'hmr-properties >> #items'))
    .toBe('items: item1,item2');
  expect(await shadowText(page, 'hmr-properties >> #color-scheme')).toBe(
    'color-scheme: dark'
  );
  expect(await shadowText(page, 'hmr-properties >> #label')).toBe(
    'label: assigned'
  );
  expect(await shadowText(page, 'hmr-properties >> #factor')).toBe('factor: 7');
  // The color-scheme state actually themes the page (html[data-color-scheme]
  // drives the css custom properties in index.html).
  await expect
    .poll(() =>
      page.evaluate(() => ({
        colorScheme: document.documentElement.dataset['colorScheme'],
        background: getComputedStyle(document.body).backgroundColor,
      }))
    )
    .toEqual({colorScheme: 'dark', background: 'rgb(20, 20, 31)'});
  // reflect: true wrote the attribute.
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.querySelector('hmr-properties')!.getAttribute('label')
      )
    )
    .toBe('assigned');
  await keepShadow(page, 'props-host', 'hmr-properties');

  await edit('src/hmr-properties.ts', (code) =>
    code.replace('Properties: HELLO', 'Properties: EDITED')
  );
  await expect
    .poll(() => shadowText(page, 'hmr-properties >> h2'), {timeout: 10_000})
    .toBe('Properties: EDITED');

  // Every reactive value survived the patch.
  expect(await shadowText(page, 'hmr-properties >> #items')).toBe(
    'items: item1,item2'
  );
  expect(await shadowText(page, 'hmr-properties >> #color-scheme')).toBe(
    'color-scheme: dark'
  );
  expect(await shadowText(page, 'hmr-properties >> #label')).toBe(
    'label: assigned'
  );
  expect(await shadowText(page, 'hmr-properties >> #factor')).toBe('factor: 7');
  expect(await sameAsKept(page, 'props-host', 'hmr-properties')).toBe(true);
  // The page color scheme survived the patch (state restored → updated() re-ran).
  expect(
    await page.evaluate(() => document.documentElement.dataset['colorScheme'])
  ).toBe('dark');

  // The patched accessors are still functional: state mutation re-renders
  // and a property assignment still reflects to the attribute.
  await page.click('hmr-properties #add-item');
  await expect
    .poll(() => shadowText(page, 'hmr-properties >> #items'))
    .toBe('items: item1,item2,item3');
  await page.evaluate(() => {
    (
      document.querySelector('hmr-properties') as HTMLElement & {label: string}
    ).label = 'reassigned';
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.querySelector('hmr-properties')!.getAttribute('label')
      )
    )
    .toBe('reassigned');
});

test('static-properties component (no decorators) survives an edit', async () => {
  const {page, edit} = fixture;

  await page.click('hmr-static-props #static-increment');
  await page.click('hmr-static-props #static-increment');
  await expect
    .poll(() => shadowText(page, 'hmr-static-props >> #static-increment'))
    .toBe('Static count: 2');
  const renders = await dataRenders(page, 'hmr-static-props');

  await edit('src/hmr-properties.ts', (code) =>
    code.replace('Static count:', 'Static tally:')
  );
  await expect
    .poll(() => shadowText(page, 'hmr-static-props >> #static-increment'), {
      timeout: 10_000,
    })
    .toBe('Static tally: 2');

  // Still reactive post-patch.
  await page.click('hmr-static-props #static-increment');
  await expect
    .poll(() => shadowText(page, 'hmr-static-props >> #static-increment'))
    .toBe('Static tally: 3');
  expect(Number(await dataRenders(page, 'hmr-static-props'))).toBeGreaterThan(
    Number(renders)
  );
});
