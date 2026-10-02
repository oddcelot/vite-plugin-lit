/**
 * The inspector runtime in a real page, driven over the HMR channel the way
 * the panel's fallback route drives it.
 *
 * The `ready` message names each loaded Lit package with its own version:
 * `lit` itself pushes no version sentinel, and lit-element's major (4) is not
 * lit's (3), so the panel must not show one as the other.
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  type InspectorMessage,
  type InspectorTreeNode,
} from '../../types/inspector.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;
const ready: Extract<InspectorMessage, {type: 'ready'}>[] = [];

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
  fixture.server.hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
    if (data.type === 'ready') ready.push(data);
  });
});

afterAll(async () => {
  await fixture?.close();
});

test('ready reports a version per Lit package', async () => {
  const before = ready.length;
  await fixture.page.reload();
  await expect.poll(() => ready.length).toBeGreaterThan(before);
  const {litPackages} = ready.at(-1)!;
  expect(Object.keys(litPackages ?? {}).sort()).toEqual([
    '@lit/reactive-element',
    'lit-element',
    'lit-html',
  ]);
  const semver = /^\d+\.\d+\.\d+/;
  for (const versions of Object.values(litPackages!)) {
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatch(semver);
  }
  expect(litPackages!['lit-element']![0]).toMatch(/^4\./);
  expect(litPackages!['lit-html']![0]).toMatch(/^3\./);
});

test('reveal scrolls the element into view', async () => {
  const {page} = fixture;
  const tree: InspectorTreeNode[][] = [];
  fixture.server.hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
    if (data.type === 'tree') tree.push(data.roots);
  });
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.querySelector('hmr-counter')!.before(spacer);
    window.scrollTo(0, 0);
  });
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'tree'});
  await expect.poll(() => tree.length).toBeGreaterThan(0);
  const id = tree
    .at(-1)!
    .find((n) => n.tagName.toLowerCase() === 'hmr-counter')!.id;
  const inView = () =>
    page.locator('hmr-counter').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
  expect(await inView()).toBe(false);

  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'reveal', id});
  await expect.poll(inView, {timeout: 5_000}).toBe(true);
  const box = page.locator('[data-lit-devtools-highlight]');
  expect(await box.evaluate((el) => getComputedStyle(el).display)).toBe(
    'block'
  );
});
