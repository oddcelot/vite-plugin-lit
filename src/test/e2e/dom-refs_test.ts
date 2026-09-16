/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vitest';
import {type Fixture, shadowText, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture?.close();
});

interface ProbeElement extends HTMLElement {
  isCachedAlive(): boolean;
  pokeObserver(): void;
  getObserverFired(): number;
}

const probeCall = <T>(expr: 'isCachedAlive' | 'getObserverFired') =>
  fixture.page
    .evaluate(
      (expr) =>
        (document.querySelector('hmr-probe') as ProbeElement)[expr]() as T,
      expr
    )
    .catch(() => null);

test('cached DOM refs and observers survive a same-module sibling edit', async () => {
  const {page, edit} = fixture;

  expect(await probeCall<boolean>('isCachedAlive')).toBe(true);

  await edit('src/hmr-probe.ts', (code) => code.replace('SIBLING', 'PATCHED'));

  await expect
    .poll(() => shadowText(page, 'hmr-probe >> hmr-probe-sibling >> #sib'), {
      timeout: 10_000,
    })
    .toBe('PATCHED');

  // The cached querySelector result is still the live node.
  expect(await probeCall<boolean>('isCachedAlive')).toBe(true);

  // The IntersectionObserver created in firstUpdated is still firing.
  const firedBefore = (await probeCall<number>('getObserverFired'))!;
  await page.evaluate(() =>
    (document.querySelector('hmr-probe') as ProbeElement).pokeObserver()
  );
  await expect
    .poll(() => probeCall<number>('getObserverFired'), {timeout: 10_000})
    .toBeGreaterThan(firedBefore);
});
