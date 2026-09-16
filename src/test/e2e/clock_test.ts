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

const secondHandTransform = () =>
  fixture.page
    .evaluate(
      () =>
        document
          .querySelector('hmr-clock')
          ?.shadowRoot?.querySelector('#second-hand')
          ?.getAttribute('transform') ?? null
    )
    .catch(() => null);

const secondHandStroke = () =>
  fixture.page
    .evaluate(() => {
      const hand = document
        .querySelector('hmr-clock')
        ?.shadowRoot?.querySelector('#second-hand');
      return hand === null || hand === undefined
        ? null
        : getComputedStyle(hand).stroke;
    })
    .catch(() => null);

test('signal-driven clock keeps ticking through hot patches', async () => {
  const {page, edit} = fixture;

  // The clock is ticking: the second hand's rotation changes.
  const before = await secondHandTransform();
  expect(before).not.toBeNull();
  await expect.poll(secondHandTransform, {timeout: 5_000}).not.toBe(before);

  await keepShadow(page, 'face', 'hmr-clock >> #face');
  await keepShadow(page, 'second-hand', 'hmr-clock >> #second-hand');
  await keepShadow(page, 'clock-host', 'hmr-clock');

  // Patch 1: css-only edit (second hand color). No template changed, so no
  // DOM is rebuilt anywhere — pure restyle while the clock runs.
  await edit('src/hmr-clock.ts', (code) => code.replace('#e63946', '#00c853'));
  await expect
    .poll(secondHandStroke, {timeout: 10_000})
    .toBe('rgb(0, 200, 83)');
  expect(await sameAsKept(page, 'face', 'hmr-clock >> #face')).toBe(true);
  expect(
    await sameAsKept(page, 'second-hand', 'hmr-clock >> #second-hand')
  ).toBe(true);

  // Patch 2: edit the hands literal (lengthen the second hand). Only the
  // hands part rebuilds; the face (its own svg literal) keeps identity.
  await edit('src/hmr-clock.ts', (code) =>
    code.replace(
      'x1="50" y1="54" x2="50" y2="10"',
      'x1="50" y1="54" x2="50" y2="14"'
    )
  );
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              document
                .querySelector('hmr-clock')
                ?.shadowRoot?.querySelector('#second-hand')
                ?.getAttribute('y2') ?? null
          )
          .catch(() => null),
      {timeout: 10_000}
    )
    .toBe('14');
  expect(await sameAsKept(page, 'face', 'hmr-clock >> #face')).toBe(true);
  expect(
    await sameAsKept(page, 'second-hand', 'hmr-clock >> #second-hand')
  ).toBe(false);
  expect(await sameAsKept(page, 'clock-host', 'hmr-clock')).toBe(true);
  expect(await shadowText(page, 'hmr-clock >> h2')).toBe('Clock: HELLO');

  // Still ticking after both patches: the signal (in its own un-edited
  // module) survived, and the patched SignalWatcher still reacts to it.
  const afterPatch = await secondHandTransform();
  await expect.poll(secondHandTransform, {timeout: 5_000}).not.toBe(afterPatch);
});
