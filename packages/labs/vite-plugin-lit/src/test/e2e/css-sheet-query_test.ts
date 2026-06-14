/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {
  dataRenders,
  type Fixture,
  keepShadow,
  sameAsKept,
  startFixture,
} from './utils.js';

/**
 * Proves the `?css-sheet` plugin query: a bare `import sheet from
 * './x.css?css-sheet'` (no `urlSheet()` call, no `import.meta.hot` in user
 * code) yields a shared, hot-swapping `CSSStyleSheet`. The plugin generates
 * the `urlSheet()` wiring *and* the `import.meta.hot.accept` line into a
 * virtual module — so the per-module boilerplate that can't live in a runtime
 * helper lives in plugin-generated source instead, where Vite's static
 * analysis still sees the literal specifier.
 */

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture?.close();
});

const A = 'hmr-vsheet-a';
const B = 'hmr-vsheet-b';

const bg = (host: string) =>
  fixture.page
    .evaluate((host) => {
      const chip = document
        .querySelector(host)
        ?.shadowRoot?.querySelector('#chip');
      return chip === null || chip === undefined
        ? null
        : getComputedStyle(chip).backgroundColor;
    }, host)
    .catch(() => null);

test('?css-sheet hot-swaps a shared sheet across adopters without re-render', async () => {
  const {edit} = fixture;

  // The sheet fetches its bytes at runtime, so the styled color lands a tick
  // after mount — both adopters share the one constructed sheet.
  await expect.poll(() => bg(A)).toBe('rgb(59, 130, 246)');
  await expect.poll(() => bg(B)).toBe('rgb(59, 130, 246)');

  expect(await dataRenders(fixture.page, A)).toBe('1');
  expect(await dataRenders(fixture.page, B)).toBe('1');

  await keepShadow(fixture.page, 'a', `${A} >> #chip`);
  await keepShadow(fixture.page, 'b', `${B} >> #chip`);

  await edit('src/hmr-vsheet.css', (css) =>
    css.replace('background: rgb(59, 130, 246);', 'background: rgb(1, 2, 3);')
  );

  // The single generated virtual module self-accepted the `?url` dep, so the
  // swap updates both adopters and never propagates to the components.
  await expect.poll(() => bg(A), {timeout: 10_000}).toBe('rgb(1, 2, 3)');
  await expect.poll(() => bg(B), {timeout: 10_000}).toBe('rgb(1, 2, 3)');

  // Same nodes, and `updated()` never fired again — no re-render, no reload.
  expect(await sameAsKept(fixture.page, 'a', `${A} >> #chip`)).toBe(true);
  expect(await sameAsKept(fixture.page, 'b', `${B} >> #chip`)).toBe(true);
  expect(await dataRenders(fixture.page, A)).toBe('1');
  expect(await dataRenders(fixture.page, B)).toBe('1');
});
