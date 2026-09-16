/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {
  type Fixture,
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

interface ListState {
  scrollTop: number;
  childCount: number;
  firstVisibleIndex: number;
  firstVisibleText: string;
}

const listState = (): Promise<ListState | null> =>
  fixture.page
    .evaluate(() => {
      const list = document
        .querySelector('hmr-virtualizer')
        ?.shadowRoot?.querySelector('#list');
      if (list === null || list === undefined) {
        return null;
      }
      const listRect = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll('.row')];
      const visible = rows
        .filter((row) => {
          const r = row.getBoundingClientRect();
          return r.bottom > listRect.top + 1 && r.top < listRect.bottom - 1;
        })
        .sort(
          (a, b) =>
            Number(a.getAttribute('data-index')) -
            Number(b.getAttribute('data-index'))
        );
      return {
        scrollTop: list.scrollTop,
        childCount: rows.length,
        firstVisibleIndex: Number(visible[0]?.getAttribute('data-index') ?? -1),
        firstVisibleText: visible[0]?.textContent?.trim() ?? '',
      };
    })
    .catch(() => null);

test('virtualizer keeps scroll position and element identity across patches', async () => {
  const {page, edit} = fixture;

  // The virtualizer defers layout until it's actually visible (it sits far
  // down the fixture page), so bring it into the viewport first.
  await page.evaluate(() =>
    document.querySelector('hmr-virtualizer')!.scrollIntoView()
  );

  // Virtualizes: renders a window, not all 1000 items.
  await expect
    .poll(async () => (await listState())?.childCount ?? 0, {timeout: 15_000})
    .toBeGreaterThan(0);
  const initial = (await listState())!;
  expect(initial.childCount).toBeLessThan(200);
  expect(initial.firstVisibleIndex).toBe(0);

  // Scroll deep into the list.
  await page.evaluate(() => {
    const list = document
      .querySelector('hmr-virtualizer')!
      .shadowRoot!.querySelector('#list')!;
    list.scrollTop = 5000;
  });
  await expect
    .poll(async () => (await listState())?.firstVisibleIndex ?? -1)
    .toBeGreaterThan(50);
  const scrolled = (await listState())!;
  await keepShadow(page, 'list', 'hmr-virtualizer >> #list');

  // Patch 1: header edit. The virtualizer (own literal) is untouched —
  // scroll offset and visible window survive.
  await edit('src/hmr-virtualizer.ts', (code) =>
    code.replace('Virtualizer: HELLO', 'Virtualizer: EDITED')
  );
  await expect
    .poll(() => shadowText(page, 'hmr-virtualizer >> h2'), {timeout: 10_000})
    .toBe('Virtualizer: EDITED');

  expect(await sameAsKept(page, 'list', 'hmr-virtualizer >> #list')).toBe(true);
  const afterHeaderEdit = (await listState())!;
  expect(Math.abs(afterHeaderEdit.scrollTop - scrolled.scrollTop)).toBeLessThan(
    5
  );
  expect(afterHeaderEdit.firstVisibleIndex).toBe(scrolled.firstVisibleIndex);

  // Patch 2: edit the row template (inside the renderItem interpolation —
  // the outer virtualizer literal's strings are unchanged). Rows re-render
  // with the new template; the scroller element and offset survive.
  await edit('src/hmr-virtualizer.ts', (code) =>
    code.replace('>${item.label}</span>', '>→ ${item.label}</span>')
  );
  await expect
    .poll(async () => (await listState())?.firstVisibleText ?? '', {
      timeout: 10_000,
    })
    .toMatch(/^→ Row \d+$/);

  expect(await sameAsKept(page, 'list', 'hmr-virtualizer >> #list')).toBe(true);
  const afterRowEdit = (await listState())!;
  expect(Math.abs(afterRowEdit.scrollTop - scrolled.scrollTop)).toBeLessThan(5);
  expect(afterRowEdit.firstVisibleIndex).toBe(scrolled.firstVisibleIndex);

  // Still a live virtualizer: scrolling further changes the window.
  await page.evaluate(() => {
    const list = document
      .querySelector('hmr-virtualizer')!
      .shadowRoot!.querySelector('#list')!;
    list.scrollTop = 10_000;
  });
  await expect
    .poll(async () => (await listState())?.firstVisibleIndex ?? -1)
    .toBeGreaterThan(afterRowEdit.firstVisibleIndex);
});
