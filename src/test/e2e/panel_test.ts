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

test('a #event= link selects the span it names', async () => {
  const {page} = panel;
  const increment = fixture.page.locator('hmr-counter #increment');
  for (let i = 0; i < 30; i++) {
    await increment.click();
  }
  const rows = page.locator('timeline-event-list .row');
  await rows.first().waitFor();

  // Selecting a row writes its start event's id into the hash.
  await rows.first().click();
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toContain('event=');
  const hash = await page.evaluate(() => location.hash);
  const selected = page.locator('timeline-event-list .row.selected');
  const linkedText = await selected.textContent();

  // Move the selection elsewhere, then follow the link back.
  await rows.last().click();
  expect(await selected.textContent()).not.toBe(linkedText);
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await expect.poll(() => selected.textContent()).toBe(linkedText);
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  // Scrolled into view, not merely selected.
  const box = (await selected.boundingBox())!;
  const list = (await page
    .locator('timeline-event-list .scroll')
    .boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(list.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(list.y + list.height + 1);
  expect(panel.errors).toEqual([]);
});

test('a #event= link to an unknown id leaves nothing selected', async () => {
  const {page} = panel;
  const selected = page.locator('timeline-event-list .row.selected');
  await selected.waitFor();
  await page.evaluate(() => {
    location.hash = '#tab=timeline&event=gone-0';
  });
  await expect.poll(() => selected.count()).toBe(0);
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .not.toContain('event=');
  expect(panel.errors).toEqual([]);
});

test('the regex filter narrows the tracks as well as the list', async () => {
  const {page} = panel;
  const increment = fixture.page.locator('hmr-counter #increment');
  for (let i = 0; i < 3; i++) {
    await increment.click();
  }
  await page.getByText('Tracks', {exact: true}).first().click();
  const marks = page.locator('timeline-tracks .mark');
  await expect.poll(() => marks.count()).toBeGreaterThan(0);

  // The filter bar stays on screen in Tracks mode.
  const regex = page.locator('timeline-view input.regex');
  await regex.fill('^no-such-span$');
  await expect.poll(() => marks.count()).toBe(0);

  await regex.fill('');
  await expect.poll(() => marks.count()).toBeGreaterThan(0);
  expect(panel.errors).toEqual([]);
});

test('a filter that hides the selected mark keeps its detail in Tracks', async () => {
  const {page} = panel;
  await fixture.page.locator('hmr-counter #increment').click();
  await page.getByText('Tracks', {exact: true}).first().click();
  const marks = page.locator('timeline-tracks .mark');
  await expect.poll(() => marks.count()).toBeGreaterThan(0);

  const detail = page.locator('timeline-tracks timeline-span-detail');
  await marks.first().click();
  await detail.waitFor();

  await page.locator('timeline-view input.regex').fill('^no-such-span$');
  await expect.poll(() => marks.count()).toBe(0);
  expect(await detail.count()).toBe(1);
  expect(panel.errors).toEqual([]);
});
