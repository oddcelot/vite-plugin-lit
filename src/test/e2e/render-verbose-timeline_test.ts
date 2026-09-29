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

/**
 * Drives one real render on `hmr-lifecycle-child` by clicking its increment
 * button — a genuine value change (`count++`), so lit-html's per-part dirty
 * check doesn't skip the text/event-listener commits the verbose layer
 * reports on.
 */
const clickIncrement = (page: Fixture['page']): Promise<void> =>
  page.evaluate(() => {
    const button = document
      .querySelector('hmr-lifecycle')
      ?.shadowRoot?.querySelector('hmr-lifecycle-child')
      ?.shadowRoot?.querySelector('#increment') as
      | HTMLElement
      | null
      | undefined;
    button?.click();
  });

// Regression guard for the opt-in verbose render layer: it must ride the same
// `emitLitDebugLogEvents` flag as `lit-render` (see `runtime/timeline/render.ts`
// and `install.ts`'s `syncRenderDebug`) without leaking per-part events onto
// the timeline when only the coarse `lit-render` layer is enabled.
test('lit-render-verbose stays silent when only lit-render is enabled', async () => {
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
    hmrIncompatible: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: false,
    litRenderEnabled: true,
    litRenderVerboseEnabled: false,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
  });

  // Poll: nudge a render each round until the coarse render layer reports —
  // then assert the verbose layer never did.
  const renderSeen = async (): Promise<boolean> => {
    await clickIncrement(page);
    return events.some((e) => e.layerId === 'lit-render');
  };
  await expect.poll(renderSeen, {timeout: 10_000}).toBe(true);

  expect(events.some((e) => e.layerId === 'lit-render-verbose')).toBe(false);
});

test('lit-render-verbose reports serializable per-part events when enabled', async () => {
  const {page} = fixture;

  const source = createHotTimelineSource();
  source.bind(fixture.server);
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: false,
    litRenderEnabled: false,
    litRenderVerboseEnabled: true,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
  });

  const verboseSeen = async (): Promise<TimelineEvent[]> => {
    await clickIncrement(page);
    return events.filter((e) => e.layerId === 'lit-render-verbose');
  };

  await expect
    .poll(async () => (await verboseSeen()).length > 0, {timeout: 10_000})
    .toBe(true);

  const verbose = await verboseSeen();
  const titles = new Set(verbose.map((e) => e.title));
  // `set part` fires once per template-bound part on every render — the
  // clearest "per-part detail" signal the verbose layer exists to expose.
  expect(titles.has('set part')).toBe(true);

  // `data` must be plain, JSON-serializable data — no DOM nodes, template
  // objects, or functions — since it crosses the HMR channel and is later
  // stored/exported as-is (see `describeValue` in `runtime/timeline/render.ts`).
  for (const event of verbose) {
    expect(() => JSON.stringify(event.data)).not.toThrow();
    const roundTripped: unknown = JSON.parse(JSON.stringify(event.data));
    expect(roundTripped).toEqual(event.data);
    // Every verbose event this run derives its host from `hmr-lifecycle-child`.
    expect(event.subtitle).toBe('hmr-lifecycle-child');
  }
});
