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
  // These read the list; the Timeline opens in Tracks.
  await panel.page.evaluate(() =>
    localStorage.setItem('lit-devtools-timeline-mode', 'list')
  );
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

test('a reloaded panel lists the events recorded before it reloaded', async () => {
  const {page} = panel;
  const increment = fixture.page.locator('hmr-counter #increment');
  for (let i = 0; i < 5; i++) {
    await increment.click();
  }
  const rows = page.locator('timeline-event-list .row');
  await rows.first().waitFor();

  // Select a row so the hash carries a link to one of the recorded spans.
  await rows.first().click();
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toContain('event=');
  const hash = await page.evaluate(() => location.hash);
  const linkedText = await page
    .locator('timeline-event-list .row.selected')
    .textContent();
  // The list is virtualized, so the DOM row count says little; the scroll
  // height is the whole list's size. Let the last batch land before reading.
  const scroller = page.locator('timeline-event-list .scroll');
  const height = () => scroller.evaluate((el) => el.scrollHeight);
  await page.waitForTimeout(500);
  const before = await height();
  expect(before).toBeGreaterThan(0);

  // No clicks from here on: whatever the reloaded panel shows can only have
  // come from the node side's history.
  await page.reload();
  await page.waitForSelector('timeline-event-list');
  // Same size as before: nothing lost to the reload, nothing doubled up by
  // the replay.
  await expect.poll(height).toBe(before);

  // The cold link resolves against the seeded events.
  const selected = page.locator('timeline-event-list .row.selected');
  await expect.poll(() => selected.textContent()).toBe(linkedText);
  expect(await page.evaluate(() => location.hash)).toBe(hash);
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
  const regex = page.locator('timeline-view wa-input.regex input');
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

  await page
    .locator('timeline-view wa-input.regex input')
    .fill('^no-such-span$');
  await expect.poll(() => marks.count()).toBe(0);
  expect(await detail.count()).toBe(1);
  expect(panel.errors).toEqual([]);
});

test('Shift+drag selects a range in Tracks and summarises it', async () => {
  const {page} = panel;
  // The previous test leaves its regex in the shared filter.
  await page.locator('timeline-view wa-input.regex input').fill('');
  await fixture.page.locator('hmr-counter #increment').click();
  await page.getByText('Tracks', {exact: true}).first().click();
  await expect
    .poll(() => page.locator('timeline-tracks .mark').count())
    .toBeGreaterThan(0);

  const ticks = (await page.locator('timeline-tracks .ticks').boundingBox())!;
  const lanes = (await page.locator('timeline-tracks .lanes').boundingBox())!;
  const y = lanes.y + 6;
  await page.keyboard.down('Shift');
  await page.mouse.move(ticks.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(ticks.x + ticks.width - 4, y, {steps: 8});
  // The bounds are on screen while dragging.
  await page.locator('timeline-tracks .range-label').waitFor();
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const summary = page.locator('timeline-tracks timeline-range-summary');
  await summary.waitFor();
  expect(await page.locator('timeline-tracks .range').count()).toBe(1);

  // The edges are sliders: keys and a drag adjust them.
  const end = page.locator('timeline-tracks [aria-label="Range end"]');
  const before = Number(await end.getAttribute('aria-valuenow'));
  await end.focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => Number(await end.getAttribute('aria-valuenow')))
    .toBeLessThan(before);
  const start = page.locator('timeline-tracks [aria-label="Range start"]');
  const startBefore = Number(await start.getAttribute('aria-valuenow'));
  const box = (await start.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, lanes.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, lanes.y + 6, {steps: 4});
  await page.mouse.up();
  await expect
    .poll(async () => Number(await start.getAttribute('aria-valuenow')))
    .toBeGreaterThan(startBefore);

  // Filter to range hands the window to the shared filter...
  await summary.getByText('Filter to range').click();
  await page.locator('timeline-view .range-chip').waitFor();
  // ...and Esc clears the selection, the chip the filter.
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.locator('timeline-tracks .range').count())
    .toBe(0);
  await page.locator('timeline-view .range-chip').click();
  await expect
    .poll(() => page.locator('timeline-view .range-chip').count())
    .toBe(0);

  // A drag on the ruler draws one too, and a click there clears it.
  await page.mouse.move(ticks.x + 10, ticks.y + 8);
  await page.mouse.down();
  await page.mouse.move(ticks.x + 200, ticks.y + 8, {steps: 8});
  await page.mouse.up();
  await page.locator('timeline-tracks .range').waitFor();
  await page.mouse.click(ticks.x + 300, ticks.y + 8);
  await expect
    .poll(() => page.locator('timeline-tracks .range').count())
    .toBe(0);
  expect(panel.errors).toEqual([]);
});

test('Pick is not offered when the source overlay is off', async () => {
  const {page} = panel;
  await page.goto(`${fixture.origin}/__lit/#tab=components`);
  await page.locator('components-view wa-button.live').waitFor();
  // `get-meta` arrives after the toolbar first renders; give it the time.
  await page.waitForTimeout(500);
  expect(await page.locator('components-view wa-button.pick').count()).toBe(0);
});
