/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {type Fixture, type PanelHandle, startFixture} from './utils.js';

/**
 * The real, built DevTools panel (`dist/client`) in a real browser. Unit and
 * jsdom-free checks can't see layout, so this is where "the rows are as wide
 * as the list" and "Clear leaves the empty state in view" are decided.
 */

let fixture: Fixture;
let panel: PanelHandle;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}, panel: true});
  panel = await fixture.openPanel();
  await panel.page.goto(`${fixture.origin}/__lit/#tab=timeline`);
  await panel.page.reload();
  await panel.page.waitForSelector('timeline-view');
});

afterAll(async () => {
  await fixture?.close();
});

test('the panel loads without console errors', async () => {
  // Let the RPC connection and first renders settle before judging.
  await panel.page.waitForSelector('timeline-event-list');
  expect(panel.errors).toEqual([]);
});

test('timeline rows span the full width of the list', async () => {
  const {page} = panel;
  // Recording is off until asked for; interact with the app to make events.
  await page.getByRole('button', {name: /Record/}).click();
  await fixture.page.locator('hmr-counter #increment').click();
  await page.locator('timeline-event-list .row').first().waitFor();

  // Locators pierce the panel's nested shadow roots; a hand-written
  // querySelector chain would not.
  const scroll = (await page
    .locator('timeline-event-list .scroll')
    .boundingBox())!;
  const widths = {
    scroll: scroll.width,
    rows: await page
      .locator('timeline-event-list .row')
      .evaluateAll((rows) =>
        rows.map((row) => row.getBoundingClientRect().width)
      ),
  };
  expect(widths.rows.length).toBeGreaterThan(0);
  for (const width of widths.rows) {
    expect(width).toBeGreaterThanOrEqual(widths.scroll - 1);
  }
});

test('Clear leaves the empty state in view', async () => {
  const {page} = panel;
  // The original bug needs a list tall enough to scroll, scrolled away from
  // the top: the virtualizer leaves its host sized to the old content.
  const scroller = page.locator('timeline-event-list .scroll');
  const increment = fixture.page.locator('hmr-counter #increment');
  for (let i = 0; i < 60; i++) {
    await increment.click();
  }
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(500);
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await page.getByRole('button', {name: 'Clear'}).click();
  const empty = page.locator('timeline-event-list .empty');
  await empty.waitFor();
  expect(await empty.textContent()).toContain('No events recorded.');
  // Inside the viewport, not merely present: a virtualizer-sized scroller
  // once pushed it thousands of px out of sight.
  const box = (await empty.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(panel.errors).toEqual([]);
});
