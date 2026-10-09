import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {TimelineChannelCodec} from '../../lib/devframe/page-codec.js';
import {fromViteHot} from '../../lib/runtime/page-transport.js';
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
// once the layer enablement is pushed (which `TimelineChannelCodec.setLayers`
// now does on record start, alongside the recording flag). Send the same
// layer state the panel would send, then dispatch input and confirm both
// layers report over the `TimelineSource` the panel consumes.
test('mouse and keyboard layers capture when enabled at record start', async () => {
  const {page} = fixture;

  // `connect()` must happen before the page (re)connects its HMR client, or the
  // page's `push-event` messages have no listener — the fixture already
  // loaded the page once in `startFixture`, so reload it after connecting.
  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
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

  // Mirror the panel: recording flag + the full layer enablement together.
  source.setRecording(true);
  source.setLayers({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: true,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: true,
    keyboardEventEnabled: true,
    customEventsEnabled: false,
    litWarningsEnabled: false,
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

// A component's own dispatchEvent is recorded only while the layer is on.
test('custom events layer records what a component dispatches, only when enabled', async () => {
  const {page} = fixture;

  const source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
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

  const layers = (customEventsEnabled: boolean) => ({
    recordingState: true,
    litLifecycleEnabled: true,
    litRenderEnabled: false,
    litRenderVerboseEnabled: false,
    litChangedValuesEnabled: false,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
    customEventsEnabled,
    litWarningsEnabled: false,
  });
  const dispatch = (type: string) =>
    page.evaluate(
      `(() => {
        const el = document.querySelector('hmr-task');
        el.dispatchEvent(new CustomEvent(${JSON.stringify(type)}, {detail: {n: 1}, bubbles: true, composed: true}));
      })()`
    );

  // Off by default: the layer state is pushed with it off.
  source.setRecording(true);
  source.setLayers(layers(false));
  await dispatch('e2e-off');

  source.setLayers(layers(true));
  await expect
    .poll(
      async () => {
        await dispatch('e2e-on');
        return events.some((e) => e.title === 'e2e-on');
      },
      {timeout: 10_000}
    )
    .toBe(true);

  expect(events.some((e) => e.title === 'e2e-off')).toBe(false);
  expect(events.find((e) => e.title === 'e2e-on')).toMatchObject({
    layerId: 'custom-events',
    subtitle: 'hmr-task',
    data: {
      type: 'e2e-on',
      kind: 'CustomEvent',
      bubbles: true,
      composed: true,
      detail: '{n: 1}',
    },
    meta: {tagName: 'hmr-task'},
  });
});
