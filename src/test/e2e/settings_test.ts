import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {type Fixture, type PanelHandle, startFixture} from './utils.js';

/**
 * The Settings tab's "config changed since you overrode this" nudge, against
 * the real panel. The panel hydrates overrides from devframe's per-user store,
 * so the store the fixture runs under (`fixture.home`) is seeded here rather
 * than the developer's own.
 */

let fixture: Fixture;
let panel: PanelHandle;

beforeAll(async () => {
  // The playground's config has `hmr.reconnect` off. An override of `on`,
  // recorded when the config said `on`, is one whose config has since moved.
  fixture = await startFixture({
    plugin: {timeline: true},
    panel: true,
    seedSettings: {
      override: {hmrReconnect: true},
      overrideBaselines: {hmrReconnect: true},
    },
  });
  panel = await fixture.openPanel();
  // Settings isn't a deep-link tab, so `#tab=settings` would not switch to it.
  await panel.page.getByText('Settings', {exact: true}).first().click();
});

afterAll(async () => {
  await fixture?.close();
});

test('an override whose config value moved shows the nudge, and Keep hides it', async () => {
  const {page} = panel;
  const nudge = page.locator('[data-nudge="hmrReconnect"]');
  await nudge.waitFor();
  expect((await nudge.innerText()).replace(/\s+/g, ' ')).toContain(
    'was on, now off'
  );

  await nudge.getByRole('button', {name: 'Keep'}).click();
  await expect.poll(() => nudge.count()).toBe(0);
  // Keep re-stamps the baseline; the override itself stays.
  expect(await page.getByText('(overridden)').count()).toBe(1);
  expect(panel.errors).toEqual([]);
});
