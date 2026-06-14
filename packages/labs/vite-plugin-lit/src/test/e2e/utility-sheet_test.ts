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
 * End-to-end proof of the `urlSheet()` pattern (the extractable half of
 * `playground/src/hmr-utility-sheet.ts`): one constructed `CSSStyleSheet`
 * adopted by two *different* component types. Editing the shared `.css` asset
 * hot-swaps the sheet in place — both adopters restyle, neither re-renders,
 * and the page does not reload. The only per-module glue is the literal
 * `import.meta.hot.accept` line that can't move into the package.
 */

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture?.close();
});

const BTN = 'hmr-utility-btn[variant="blue"]';
const BADGE = 'hmr-utility-badge';

// `.text-white` is shared by the button's `<button>` and the badge's first
// `<span>`, so one edit to it should reach both shadow roots.
const color = (path: string) =>
  fixture.page
    .evaluate((path) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      return node === null ? null : getComputedStyle(node).color;
    }, path)
    .catch(() => null);

test('editing a shared utility sheet restyles every adopter without re-render', async () => {
  const {edit} = fixture;

  // The sheet fetches its bytes at runtime, so the styled color lands a tick
  // after mount.
  await expect.poll(() => color(`${BTN} >> button`)).toBe('rgb(255, 255, 255)');
  await expect.poll(() => color(`${BADGE} >> span`)).toBe('rgb(255, 255, 255)');

  // Both components render exactly once on mount.
  expect(await dataRenders(fixture.page, BTN)).toBe('1');
  expect(await dataRenders(fixture.page, BADGE)).toBe('1');

  // Pin DOM identity in both shadow roots — a hot-swap must not rebuild them.
  await keepShadow(fixture.page, 'btn', `${BTN} >> button`);
  await keepShadow(fixture.page, 'badge', `${BADGE} >> span`);

  await edit('src/hmr-utility-sheet.css', (css) =>
    css.replace('color: #fff;', 'color: rgb(1, 2, 3);')
  );

  // The single shared sheet updates, so both adopters pick up the new color.
  await expect
    .poll(() => color(`${BTN} >> button`), {timeout: 10_000})
    .toBe('rgb(1, 2, 3)');
  await expect
    .poll(() => color(`${BADGE} >> span`), {timeout: 10_000})
    .toBe('rgb(1, 2, 3)');

  // Same nodes as before the edit — `replaceSync()` mutated the sheet, it did
  // not re-render the components or reload the page.
  expect(await sameAsKept(fixture.page, 'btn', `${BTN} >> button`)).toBe(true);
  expect(await sameAsKept(fixture.page, 'badge', `${BADGE} >> span`)).toBe(
    true
  );

  // And `updated()` never fired again on either component.
  expect(await dataRenders(fixture.page, BTN)).toBe('1');
  expect(await dataRenders(fixture.page, BADGE)).toBe('1');
});
