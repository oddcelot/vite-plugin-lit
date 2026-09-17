/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {createHotTimelineSource} from '../../lib/devframe/vite.js';
import type {TimelineEvent} from '../../types/timeline.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
});

afterAll(async () => {
  await fixture?.close();
});

// The mouse/keyboard layers default off in the runtime, so they only capture
// once the layer enablement is pushed (which `HotTimelineSource.setLayers`
// now does on record start, alongside the recording flag). Send the same
// layer state the panel would send, then dispatch input and confirm both
// layers report over the `TimelineSource` the panel consumes.
test('mouse and keyboard layers capture when enabled at record start', async () => {
  const {page} = fixture;

  // `bind()` must happen before the page (re)connects its HMR client, or the
  // page's `push-event` messages have no listener — the fixture already
  // loaded the page once in `startFixture`, so reload it after binding.
  const source = createHotTimelineSource();
  source.bind(fixture.server);
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  // Mirror the panel: recording flag + the full layer enablement together.
  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: true,
    mouseEventEnabled: true,
    keyboardEventEnabled: true,
  });

  const layersSeen = async (): Promise<Set<string>> => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new MouseEvent('click', {clientX: 5, clientY: 5, bubbles: true})
      );
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    });
    return new Set(events.map((e) => e.layerId));
  };

  await expect
    .poll(async () => (await layersSeen()).has('mouse'), {timeout: 10_000})
    .toBe(true);
  const layers = await layersSeen();
  expect(layers.has('mouse')).toBe(true);
  expect(layers.has('keyboard')).toBe(true);
});
