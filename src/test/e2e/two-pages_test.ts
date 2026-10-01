import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {type Fixture, type PanelHandle, startFixture} from './utils.js';

/**
 * The HMR channel is a broadcast, so a second tab of the app used to wipe the
 * recording the panel was showing. The node side now follows one page at a
 * time and the panel says when it switches.
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

test('a second tab takes over, says so, and the first one is ignored', async () => {
  const {page} = panel;
  const rows = page.locator('timeline-event-list .row');
  const banner = page.locator('.page-changed');
  await page.getByRole('button', {name: /Record/}).click();
  await fixture.page.locator('hmr-counter #increment').click();
  await rows.first().waitFor();
  expect(await banner.count()).toBe(0);

  const second = await fixture.browser.newPage();
  try {
    await second.goto(fixture.origin);
    await banner.waitFor({timeout: 10_000});
    expect(await banner.textContent()).toContain('Another page connected');

    // The first tab is still live, but it is no longer the page being
    // followed, so its events never reach the recording.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const before = await rows.count();
    await fixture.page.locator('hmr-counter #increment').click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await rows.count()).toBe(before);

    await page.locator('.page-changed button').click();
    expect(await banner.count()).toBe(0);
  } finally {
    await second.close();
  }
});
