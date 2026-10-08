import {describe, expect, test} from 'vite-plus/test';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
} from '../../types/inspector.js';
import type {InspectorMessage} from '../../types/inspector.js';
import {HMR_INCOMPATIBLE_CHANNEL} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {HMR_PATCH_CHANNEL} from '../../types/hmr-patch.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';
import {
  CHANNEL_CUSTOM_LAYER,
  CHANNEL_LAYERS_CHANGED,
  CHANNEL_PUSH_EVENT,
  CHANNEL_RECORDING_CHANGED,
  CHANNEL_RUNTIME_READY,
  DEFAULT_LAYERS_STATE,
  SETTINGS_OVERRIDE_CHANNEL,
} from '../../types/timeline.js';
import type {TimelineEvent, TimelineLayer} from '../../types/timeline.js';
import {TimelineChannelCodec} from '../../lib/devframe/page-codec.js';
import type {PageTransport} from '../../lib/runtime/page-transport.js';
import type {TimelineSink} from '../../lib/devframe/source.js';

class RecordingSink implements TimelineSink {
  readonly calls: Array<[string, unknown]> = [];
  /** The page id each call carried, in call order (undefined when absent). */
  readonly pageIds: Array<string | undefined> = [];
  pushEvents(events: TimelineEvent[], pageId?: string) {
    this.calls.push(['pushEvents', events]);
    this.pageIds.push(pageId);
  }
  addLayer(layer: TimelineLayer, pageId?: string) {
    this.calls.push(['addLayer', layer]);
    this.pageIds.push(pageId);
  }
  inspectorMessage(msg: InspectorMessage, pageId?: string) {
    this.calls.push(['inspectorMessage', msg]);
    this.pageIds.push(pageId);
  }
  hmrIncompatible(event: HmrIncompatibilityEvent, pageId?: string) {
    this.calls.push(['hmrIncompatible', event]);
    this.pageIds.push(pageId);
  }
  hmrPatched(event: HmrPatchEvent, pageId?: string) {
    this.calls.push(['hmrPatched', event]);
    this.pageIds.push(pageId);
  }
  readonly tabIds: Array<string | undefined> = [];
  runtimeReady(pageId?: string, tabId?: string) {
    this.calls.push(['runtimeReady', undefined]);
    this.pageIds.push(pageId);
    this.tabIds.push(tabId);
  }
}

const setup = (onPick?: (id: number) => void) => {
  const handlers = new Map<string, (data: unknown) => void>();
  const sent: Array<[string, unknown]> = [];
  const carrier: PageTransport = {
    on: (channel, cb) => {
      handlers.set(channel, cb);
      return () => handlers.delete(channel);
    },
    send: (channel, data) => void sent.push([channel, data]),
  };
  const codec = new TimelineChannelCodec({onPick});
  const sink = new RecordingSink();
  codec.connect(carrier);
  const detach = codec.attach(sink);
  const deliver = (channel: string, data: unknown) =>
    handlers.get(channel)?.(data);
  return {codec, sink, sent, deliver, detach, handlers};
};

describe('TimelineChannelCodec inbound', () => {
  test('maps each channel onto its sink method', () => {
    const {sink, deliver} = setup();
    const events = [{id: 1}] as unknown as TimelineEvent[];
    const layer = {id: 'mine'} as TimelineLayer;
    const msg: InspectorMessage = {type: 'ready'};
    const incompatible = {reason: 'x'} as unknown as HmrIncompatibilityEvent;
    deliver(CHANNEL_PUSH_EVENT, {events});
    deliver(CHANNEL_CUSTOM_LAYER, {layer});
    deliver(INSPECT_DATA_CHANNEL, msg);
    deliver(HMR_INCOMPATIBLE_CHANNEL, incompatible);
    deliver(CHANNEL_RUNTIME_READY, {});
    expect(sink.calls).toEqual([
      ['pushEvents', events],
      ['addLayer', layer],
      ['inspectorMessage', msg],
      ['hmrIncompatible', incompatible],
      ['runtimeReady', undefined],
    ]);
  });

  test('ignores malformed payloads', () => {
    const {sink, deliver} = setup();
    deliver(CHANNEL_CUSTOM_LAYER, {layer: {}});
    deliver(CHANNEL_CUSTOM_LAYER, undefined);
    deliver(INSPECT_DATA_CHANNEL, null);
    deliver(INSPECT_DATA_CHANNEL, {type: 3});
    deliver(HMR_INCOMPATIBLE_CHANNEL, 'nope');
    const patched = {
      tagName: 'x-a',
      instances: 1,
      generation: 1,
      durationMs: 1,
      childState: 'transfer',
      at: 1,
    };
    deliver(HMR_PATCH_CHANNEL, 'nope');
    deliver(HMR_PATCH_CHANNEL, null);
    deliver(HMR_PATCH_CHANNEL, {...patched, tagName: undefined});
    deliver(HMR_PATCH_CHANNEL, {...patched, instances: '3'});
    deliver(HMR_PATCH_CHANNEL, {...patched, instances: undefined});
    deliver(HMR_PATCH_CHANNEL, {...patched, durationMs: null});
    expect(sink.calls).toEqual([]);
  });

  test('delivers a patch event with its page id beside it', () => {
    const {sink, deliver} = setup();
    const patched: HmrPatchEvent = {
      tagName: 'x-a',
      instances: 2,
      generation: 1,
      durationMs: 1.5,
      childState: 'transfer',
      at: 10,
    };
    deliver(HMR_PATCH_CHANNEL, {...patched, pageId: 'a'});
    deliver(HMR_PATCH_CHANNEL, patched);
    expect(sink.calls).toEqual([
      ['hmrPatched', patched],
      ['hmrPatched', patched],
    ]);
    expect(sink.pageIds).toEqual(['a', undefined]);
  });

  test('pushes an empty batch when events are missing or not an array', () => {
    const {sink, deliver} = setup();
    deliver(CHANNEL_PUSH_EVENT, null);
    deliver(CHANNEL_PUSH_EVENT, {events: 'nope'});
    expect(sink.calls).toEqual([
      ['pushEvents', []],
      ['pushEvents', []],
    ]);
  });

  test('hands the page id to the sink beside the payload', () => {
    const {sink, deliver} = setup();
    const events = [{id: 1}] as unknown as TimelineEvent[];
    deliver(CHANNEL_PUSH_EVENT, {events, pageId: 'a'});
    deliver(CHANNEL_RUNTIME_READY, {pageId: 'a'});
    deliver(INSPECT_DATA_CHANNEL, {type: 'tree', roots: [], pageId: 'b'});
    expect(sink.pageIds).toEqual(['a', 'a', 'b']);
  });

  test('strips the page id off picks, custom layers and incompatibilities', () => {
    const {sink, deliver} = setup();
    const layer = {id: 'mine'} as TimelineLayer;
    const incompatible = {reason: 'x'} as unknown as HmrIncompatibilityEvent;
    deliver(INSPECT_DATA_CHANNEL, {type: 'pick', id: 7, pageId: 'a'});
    deliver(CHANNEL_CUSTOM_LAYER, {layer, pageId: 'b'});
    deliver(HMR_INCOMPATIBLE_CHANNEL, {...incompatible, pageId: 'c'});
    expect(sink.calls).toEqual([
      ['inspectorMessage', {type: 'pick', id: 7}],
      ['addLayer', layer],
      ['hmrIncompatible', incompatible],
    ]);
    expect(sink.pageIds).toEqual(['a', 'b', 'c']);
  });

  test('hands the tab id of a ready to the sink', () => {
    const {sink, deliver} = setup();
    deliver(CHANNEL_RUNTIME_READY, {pageId: 'a', tabId: 't'});
    deliver(CHANNEL_RUNTIME_READY, {pageId: 'a', tabId: 3});
    deliver(CHANNEL_RUNTIME_READY, {});
    expect(sink.tabIds).toEqual(['t', undefined, undefined]);
  });

  test('strips the page id off the inspector message', () => {
    const {sink, deliver} = setup();
    deliver(INSPECT_DATA_CHANNEL, {type: 'ready', pageId: 'a'});
    expect(sink.calls).toEqual([['inspectorMessage', {type: 'ready'}]]);
  });

  test('reads a missing or non-string page id as absent', () => {
    const {sink, deliver} = setup();
    deliver(CHANNEL_PUSH_EVENT, {events: []});
    deliver(CHANNEL_PUSH_EVENT, {events: [], pageId: 3});
    deliver(CHANNEL_RUNTIME_READY, {});
    deliver(CHANNEL_RUNTIME_READY, null);
    deliver(INSPECT_DATA_CHANNEL, {type: 'ready', pageId: 3});
    expect(sink.pageIds).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test('calls the pick hook before the sink, for picks only', () => {
    const order: string[] = [];
    const {sink, deliver} = setup((id) => order.push(`pick:${id}`));
    sink.inspectorMessage = (msg) => void order.push(`sink:${msg.type}`);
    deliver(INSPECT_DATA_CHANNEL, {type: 'pick', id: 7});
    deliver(INSPECT_DATA_CHANNEL, {type: 'ready'});
    expect(order).toEqual(['pick:7', 'sink:pick', 'sink:ready']);
  });

  test('a pick still reaches the sink when no hook is given', () => {
    const {sink, deliver} = setup();
    deliver(INSPECT_DATA_CHANNEL, {type: 'pick', id: 7});
    expect(sink.calls).toEqual([['inspectorMessage', {type: 'pick', id: 7}]]);
  });

  test('drops messages with no sink attached, and after detach', () => {
    const {sink, deliver, detach} = setup();
    detach();
    deliver(CHANNEL_RUNTIME_READY, {});
    expect(sink.calls).toEqual([]);
  });

  test('a stale detach does not remove a newer sink', () => {
    const {codec, deliver, detach} = setup();
    const next = new RecordingSink();
    codec.attach(next);
    detach();
    deliver(CHANNEL_RUNTIME_READY, {});
    expect(next.calls).toEqual([['runtimeReady', undefined]]);
  });
});

describe('TimelineChannelCodec outbound', () => {
  test('writes each command to its channel', () => {
    const {codec, sent} = setup();
    codec.toggleOverlay();
    codec.sendInspector({type: 'tree'});
    codec.setRecording(true);
    codec.setLayers({...DEFAULT_LAYERS_STATE, litRenderEnabled: false});
    const override = {};
    codec.setSettingsOverride(override);
    expect(sent).toEqual([
      [INSPECT_OVERLAY_TOGGLE_CHANNEL, undefined],
      [INSPECT_CMD_CHANNEL, {type: 'tree'}],
      [CHANNEL_RECORDING_CHANGED, {recording: true}],
      [
        CHANNEL_LAYERS_CHANGED,
        {
          litLifecycleEnabled: DEFAULT_LAYERS_STATE.litLifecycleEnabled,
          litRenderEnabled: false,
          litRenderVerboseEnabled: DEFAULT_LAYERS_STATE.litRenderVerboseEnabled,
          litChangedValuesEnabled: DEFAULT_LAYERS_STATE.litChangedValuesEnabled,
          mouseEventEnabled: DEFAULT_LAYERS_STATE.mouseEventEnabled,
          keyboardEventEnabled: DEFAULT_LAYERS_STATE.keyboardEventEnabled,
          customEventsEnabled: DEFAULT_LAYERS_STATE.customEventsEnabled,
        },
      ],
      [SETTINGS_OVERRIDE_CHANNEL, override],
    ]);
  });

  test('drops commands before a carrier is connected', () => {
    const codec = new TimelineChannelCodec();
    expect(() => codec.setRecording(true)).not.toThrow();
  });
});
