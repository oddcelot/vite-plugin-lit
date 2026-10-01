import {describe, expect, test} from 'vite-plus/test';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
} from '../../types/inspector.js';
import type {InspectorMessage} from '../../types/inspector.js';
import {HMR_INCOMPATIBLE_CHANNEL} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {
  DEFAULT_LAYERS_STATE,
  SETTINGS_OVERRIDE_CHANNEL,
} from '../../types/timeline.js';
import type {TimelineEvent, TimelineLayer} from '../../types/timeline.js';
import {TimelineChannelCodec} from '../../lib/devframe/page-codec.js';
import type {PageCarrier} from '../../lib/devframe/page-codec.js';
import {
  CHANNEL_CUSTOM_LAYER,
  CHANNEL_LAYERS_CHANGED,
  CHANNEL_PUSH_EVENT,
  CHANNEL_RECORDING_CHANGED,
  CHANNEL_RUNTIME_READY,
} from '../../lib/devframe/protocol.js';
import type {TimelineSink} from '../../lib/devframe/source.js';

class RecordingSink implements TimelineSink {
  readonly calls: Array<[string, unknown]> = [];
  pushEvents(events: TimelineEvent[]) {
    this.calls.push(['pushEvents', events]);
  }
  addLayer(layer: TimelineLayer) {
    this.calls.push(['addLayer', layer]);
  }
  inspectorMessage(msg: InspectorMessage) {
    this.calls.push(['inspectorMessage', msg]);
  }
  hmrIncompatible(event: HmrIncompatibilityEvent) {
    this.calls.push(['hmrIncompatible', event]);
  }
  runtimeReady() {
    this.calls.push(['runtimeReady', undefined]);
  }
}

const setup = (onPick?: (id: number) => void) => {
  const handlers = new Map<string, (data: unknown) => void>();
  const sent: Array<[string, unknown]> = [];
  const carrier: PageCarrier = {
    on: (channel, cb) => void handlers.set(channel, cb),
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
    expect(sink.calls).toEqual([]);
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
          mouseEventEnabled: DEFAULT_LAYERS_STATE.mouseEventEnabled,
          keyboardEventEnabled: DEFAULT_LAYERS_STATE.keyboardEventEnabled,
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
