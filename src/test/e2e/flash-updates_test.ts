/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Flash-on-update, end to end: the lifecycle wrapper's update hook, the
 * settings override read at boot, and the overlay drawn over the real element.
 * The interesting failures — the hook never firing when the timeline is not
 * recording, the box landing at the wrong rect, a box outliving its fade —
 * all need a real page.
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {SETTINGS_OVERRIDE_LS_KEY} from '../../types/timeline.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

const BOX = '[data-lit-devtools-flash]';

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
});

afterAll(async () => {
  await fixture?.close();
});

/** Force one update cycle on the counter and wait for it to settle. */
const updateCounter = () =>
  fixture.page.evaluate(async () => {
    const el = document.querySelector('hmr-counter') as
      | (Element & {requestUpdate(): void; updateComplete: Promise<unknown>})
      | null;
    if (el === null) throw new Error('no hmr-counter in the fixture page');
    el.requestUpdate();
    await el.updateComplete;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  });

test('draws nothing until the preference is on', async () => {
  const {page} = fixture;
  await updateCounter();
  expect(await page.locator(BOX).count()).toBe(0);
  expect(await page.locator('[data-lit-devtools-flash-layer]').count()).toBe(0);
});

test('flashes an updated element over its rect, then fades out', async () => {
  const {page} = fixture;

  // The boot path: the runtime reads the same-origin override synchronously.
  await page.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify({flashUpdates: true})),
    SETTINGS_OVERRIDE_LS_KEY
  );
  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );
  // Mounts flash on load; let those fade before measuring ours.
  await expect.poll(() => page.locator(BOX).count(), {timeout: 5_000}).toBe(0);

  await updateCounter();
  const box = page.locator(BOX);
  await expect.poll(() => box.count(), {timeout: 2_000}).toBe(1);
  expect(await box.getAttribute('data-level')).toBe('0');

  const [boxRect, elRect] = await Promise.all([
    box.boundingBox(),
    page.locator('hmr-counter').boundingBox(),
  ]);
  expect(boxRect).not.toBeNull();
  expect(Math.round(boxRect!.width)).toBe(Math.round(elRect!.width));
  expect(Math.round(boxRect!.y)).toBe(Math.round(elRect!.y));

  // Gone once the fade finishes: no leak of boxes across updates.
  await expect.poll(() => box.count(), {timeout: 3_000}).toBe(0);
});

test('the ramp colours by update frequency; off wipes the layer', async () => {
  const {page} = fixture;

  // Same module instance as the injected runtime — see in-page-channel_test
  // for why the URL is normalised before importing.
  const src = await page.getAttribute('script[src*="timeline/install"]', 'src');
  expect(src).not.toBeNull();
  const flashUrl = src!
    .replace('/@fs//', '/@fs/')
    .replace('timeline/install', 'timeline/flash');

  await page.evaluate(`(async () => {
    const flash = await import(${JSON.stringify(flashUrl)});
    flash.setFlashRamp(true);
  })()`);

  // Four updates well inside the one-second window -> level 2.
  for (let i = 0; i < 4; i++) await updateCounter();
  const box = page.locator(BOX);
  await expect.poll(() => box.count(), {timeout: 2_000}).toBe(1);
  expect(await box.getAttribute('data-level')).toBe('2');

  // Turning the preference off removes what is mid-fade and stops new boxes.
  await page.evaluate(`(async () => {
    const flash = await import(${JSON.stringify(flashUrl)});
    flash.setFlashEnabled(false);
  })()`);
  expect(await box.count()).toBe(0);
  await updateCounter();
  expect(await box.count()).toBe(0);
});
