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

// Regression guard: the lifecycle layer must instrument *every* Lit element via
// the shared base prototype (not just the first registered one, and regardless
// of whether the prod Lit build exposes `reactiveElementVersions`). We record,
// drive an update on the lifecycle demo child, and confirm the phase events
// flow over the `TimelineSource` the panel consumes.
test('lifecycle layer reports update phases over the timeline source', async () => {
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
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  // Turn recording on (relayed to the page runtime over HMR).
  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: true,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
  });

  // Poll: nudge an update on the demo child each round (recording may not be
  // wired on the first tick) until the lifecycle phases show up.
  const titlesSeen = async (): Promise<string[]> => {
    await page.evaluate(() => {
      const child = document
        .querySelector('hmr-lifecycle')
        ?.shadowRoot?.querySelector('hmr-lifecycle-child') as
        | {requestUpdate?: () => void}
        | null
        | undefined;
      child?.requestUpdate?.();
    });
    return events
      .filter((e) => e.layerId === 'lit-lifecycle')
      .map((e) => e.title ?? '');
  };

  await expect
    .poll(async () => (await titlesSeen()).includes('performUpdate:start'), {
      timeout: 10_000,
    })
    .toBe(true);

  const titles = new Set(await titlesSeen());
  // The full update cycle: performUpdate brackets willUpdate, update, updated.
  for (const phase of ['performUpdate', 'willUpdate', 'update', 'updated']) {
    expect(titles.has(`${phase}:start`)).toBe(true);
    expect(titles.has(`${phase}:end`)).toBe(true);
  }
});

// The Changed values layer adds old/new previews to the real update phase, read
// off a real Lit element, and only when it is on.
test('changed values layer records the old and new value of a property', async () => {
  const {page} = fixture;

  const source = createHotTimelineSource();
  source.bind(fixture.server);
  const events: TimelineEvent[] = [];
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });

  await page.reload();
  await page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );

  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: true,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: true,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
  });

  const detail = () =>
    events
      .filter((e) => e.title === 'update:start')
      .map((e) => (e.data as {changedDetail?: unknown}).changedDetail)
      .find((d) => d !== undefined);

  // Bump `count` each round: recording may not be wired on the first click.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const child = document
            .querySelector('hmr-lifecycle')
            ?.shadowRoot?.querySelector('hmr-lifecycle-child');
          child?.shadowRoot?.querySelector<HTMLElement>('#increment')?.click();
        });
        return detail();
      },
      {timeout: 10_000}
    )
    .toMatchObject([{key: 'count', sameRef: false, equal: false}]);
});
