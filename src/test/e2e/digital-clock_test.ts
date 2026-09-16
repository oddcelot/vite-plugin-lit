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

const TZ = 'Pacific/Kiritimati'; // UTC+14, no DST — differs from any CI host.

const digitalText = () =>
  shadowText(fixture.page, 'hmr-digital-clock >> #digital');

test('digital clock formats via Intl, follows the timezone picker, survives a patch', async () => {
  const {page, edit} = fixture;

  // Ticking, Intl-formatted (en-US timeStyle: medium).
  await expect.poll(digitalText).toMatch(/^\d{1,2}:\d{2}:\d{2}/);
  const before = await digitalText();
  await expect.poll(digitalText, {timeout: 5_000}).not.toBe(before);

  await keepShadow(page, 'tz-input', 'hmr-digital-clock >> #tz-input');

  // Pick a timezone through the datalist input.
  await page.evaluate((tz) => {
    const input = document
      .querySelector('hmr-digital-clock')!
      .shadowRoot!.querySelector('#tz-input') as HTMLInputElement;
    input.value = tz;
    input.dispatchEvent(new Event('change'));
  }, TZ);
  await expect
    .poll(() => shadowText(page, 'hmr-digital-clock >> #tz'))
    .toBe(TZ);

  // The displayed hour agrees with this host's Intl for the same zone.
  await expect
    .poll(async () => {
      const displayed = await digitalText();
      const expected = new Intl.DateTimeFormat('en-US', {
        timeStyle: 'medium',
        timeZone: TZ,
      }).format(new Date());
      return displayed?.split(':')[0] === expected.split(':')[0];
    })
    .toBe(true);

  // The analog clock follows the same shared signal: its hour hand points
  // where Intl says Kiritimati's hour is.
  await expect
    .poll(async () => {
      const transform = await page
        .evaluate(
          () =>
            document
              .querySelector('hmr-clock')
              ?.shadowRoot?.querySelector('#hour-hand')
              ?.getAttribute('transform') ?? null
        )
        .catch(() => null);
      const actual = Number(/rotate\(([\d.]+)/.exec(transform ?? '')?.[1]);
      const parts = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
        timeZone: TZ,
      }).formatToParts(new Date());
      const num = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value ?? 0);
      const expected = ((num('hour') % 12) + num('minute') / 60) * 30;
      return Math.abs(actual - expected) < 1;
    })
    .toBe(true);

  // Patch the display literal only: the picker (a sibling literal) keeps
  // its DOM and the timezone signal keeps its value.
  await edit('src/hmr-digital-clock.ts', (code) =>
    code.replace('<time id="digital">', '<time id="digital" data-edited="">')
  );
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              document
                .querySelector('hmr-digital-clock')
                ?.shadowRoot?.querySelector('#digital')
                ?.hasAttribute('data-edited') ?? false
          )
          .catch(() => false),
      {timeout: 10_000}
    )
    .toBe(true);
  expect(
    await sameAsKept(page, 'tz-input', 'hmr-digital-clock >> #tz-input')
  ).toBe(true);
  expect(await shadowText(page, 'hmr-digital-clock >> #tz')).toBe(TZ);

  // Still ticking after the patch.
  const afterPatch = await digitalText();
  await expect.poll(digitalText, {timeout: 5_000}).not.toBe(afterPatch);
});
