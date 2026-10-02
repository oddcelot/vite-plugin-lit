import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {
  type Fixture,
  type PanelHandle,
  shadowText,
  startFixture,
} from './utils.js';

/**
 * A real edit, all the way through: the page applies the patch, reports it
 * on `lit:hmr:patched`, the node keeps it for `lit:hmr-history`, and the
 * Components tab shows the last-patch line, both live and from the history
 * after a reload of the panel. A reload of the app is a new page, so the
 * history goes with it.
 */

let fixture: Fixture;
let panel: PanelHandle;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}, panel: true});
  panel = await fixture.openPanel();
  await panel.page.goto(`${fixture.origin}/__lit/#tab=components`);
  await panel.page.reload();
  await panel.page.waitForSelector('components-view');
});

afterAll(async () => {
  await fixture?.close();
});

test('a hot patch reaches the HMR history and the Components patch line', async () => {
  const {page} = panel;
  const line = page.locator('components-view .hmr-last-patch');
  expect(await line.count()).toBe(0);

  await fixture.edit('src/hmr-counter.ts', (code) =>
    code.replace('Count: ${this.count}', 'Tally: ${this.count}')
  );
  try {
    await expect
      .poll(() => shadowText(fixture.page, 'hmr-counter >> #increment'), {
        timeout: 10_000,
      })
      .toBe('Tally: 0');
  } catch (error) {
    throw new Error(`${String(error)} (${await fixture.stalledLayer()})`);
  }

  // Live, over the `hmr-patched` broadcast.
  await line.waitFor({timeout: 10_000});
  expect(await line.textContent()).toContain('Patched <hmr-counter>');

  // A fresh panel has seen no broadcast; it reads the node's history.
  await page.reload();
  await line.waitFor({timeout: 10_000});
  expect(await line.textContent()).toContain('Patched <hmr-counter>');

  // A reloaded app loaded the edited code fresh; nothing was patched there.
  await fixture.page.reload();
  await line.waitFor({state: 'detached', timeout: 10_000});
  await page.reload();
  await page.waitForSelector('components-view');
  await page.locator('components-view .row').first().waitFor();
  expect(await line.count()).toBe(0);
});
