import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {
  type Fixture,
  type PanelHandle,
  fsp,
  joinPath,
  startFixture,
} from './utils.js';

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
    // The overlay is on so the Components tab has a picker to offer.
    plugin: {timeline: true, sourceOverlay: true},
    panel: true,
    seedSettings: {
      override: {hmrReconnect: true},
      overrideBaselines: {hmrReconnect: true},
      appearance: 'dark',
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
  expect(await page.locator('devtools-settings .ovr').count()).toBe(1);
  expect(panel.errors).toEqual([]);
});

test('the color scheme is adopted from the store and written back to it', async () => {
  const {page} = panel;
  const rootClass = () =>
    page.evaluate(() => document.documentElement.className);
  // Seeded `dark` in the store, never set in this browser.
  await expect.poll(rootClass).toContain('color-scheme-dark');

  await page
    .locator('devtools-settings wa-select')
    .filter({has: page.locator('wa-option[value="light"]')})
    .click();
  await page.locator('devtools-settings wa-option[value="light"]').click();
  await expect.poll(rootClass).toContain('color-scheme-light');
  const store = joinPath(
    fixture.home,
    '.vite',
    'devtools',
    'settings',
    'lit.json'
  );
  await expect
    .poll(async () => JSON.parse(await fsp.readFile(store, 'utf8')).appearance)
    .toBe('light');
});

test('Pick is offered when the source overlay is on', async () => {
  const {page} = panel;
  await page.getByText('Components', {exact: true}).first().click();
  await page.locator('components-view wa-button.pick').waitFor();
});
