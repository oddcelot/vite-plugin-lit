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

test('shared + instance signals keep value and reactivity across a patch', async () => {
  const {page, edit} = fixture;

  // Shared signal updates both watchers; instance signal only the counter.
  await page.click('hmr-signal-counter #signal-increment');
  await page.click('hmr-signal-counter #signal-increment');
  await page.click('hmr-signal-counter #local-increment');
  await expect
    .poll(() => shadowText(page, 'hmr-signal-counter >> #signal-increment'))
    .toBe('Signal count: 2');
  await expect
    .poll(() => shadowText(page, 'hmr-signal-mirror >> #mirror'))
    .toBe('Mirror: 2');
  expect(await shadowText(page, 'hmr-signal-counter >> #local-increment')).toBe(
    'Local count: 1'
  );

  // The mirror's template is content-identical after re-execution, so its
  // DOM node must keep identity (signals html tag interns like core html).
  await keepShadow(page, 'mirror-p', 'hmr-signal-mirror >> #mirror');
  await keepShadow(page, 'counter-host', 'hmr-signal-counter');

  await edit('src/hmr-signals.ts', (code) =>
    code.replace('Signals: HELLO', 'Signals: EDITED')
  );
  await expect
    .poll(() => shadowText(page, 'hmr-signal-counter >> h2'), {
      timeout: 10_000,
    })
    .toBe('Signals: EDITED');

  // Values survived: the shared signal lives in an un-edited module, the
  // instance signal lives on the untouched instance.
  expect(
    await shadowText(page, 'hmr-signal-counter >> #signal-increment')
  ).toBe('Signal count: 2');
  expect(await shadowText(page, 'hmr-signal-mirror >> #mirror')).toBe(
    'Mirror: 2'
  );
  expect(await shadowText(page, 'hmr-signal-counter >> #local-increment')).toBe(
    'Local count: 1'
  );
  expect(
    await sameAsKept(page, 'mirror-p', 'hmr-signal-mirror >> #mirror')
  ).toBe(true);
  expect(await sameAsKept(page, 'counter-host', 'hmr-signal-counter')).toBe(
    true
  );

  // Reactivity survived the patch: the SignalWatcher mixin chain was
  // re-parented, and both watchers still react to the shared signal.
  await page.click('hmr-signal-counter #signal-increment');
  await expect
    .poll(() => shadowText(page, 'hmr-signal-counter >> #signal-increment'))
    .toBe('Signal count: 3');
  await expect
    .poll(() => shadowText(page, 'hmr-signal-mirror >> #mirror'))
    .toBe('Mirror: 3');
  await page.click('hmr-signal-counter #local-increment');
  await expect
    .poll(() => shadowText(page, 'hmr-signal-counter >> #local-increment'))
    .toBe('Local count: 2');
});
