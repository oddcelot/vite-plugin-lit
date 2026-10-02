/**
 * The `ready` message a real page sends names each loaded Lit package with
 * its own version. `lit` itself pushes no version sentinel, and lit-element's
 * major (4) is not lit's (3), so the panel must not show one as the other.
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {
  INSPECT_DATA_CHANNEL,
  type InspectorMessage,
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
