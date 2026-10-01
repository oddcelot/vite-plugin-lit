import {afterEach, describe, expect, test} from 'vite-plus/test';
import {initDevframe} from 'devframe/initiate';
import type {DevframeInstance} from 'devframe/initiate';
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
import {
  createRpcTimelineSource,
  createStandaloneLitDevframe,
} from '../../lib/devframe/rpc-source.js';
import type {PageLinkNode} from '../../lib/devframe/rpc-source.js';
import type {TimelineSink} from '../../lib/devframe/source.js';
import {createRpcTransport} from '../../lib/runtime/rpc-transport.js';
import type {PageRpc} from '../../lib/runtime/rpc-transport.js';

// The page-to-server mapping: which sink method each runtime channel lands on.

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

const linkedSource = () => {
  const source = createRpcTimelineSource();
  const sink = new RecordingSink();
  const outgoing: Array<[string, unknown]> = [];
  let deliver!: (channel: string, data: unknown) => void;
  const node: PageLinkNode = {
    onPageMessage: (handler) => void (deliver = handler),
    sendToPages: (channel, data) => void outgoing.push([channel, data]),
  };
  source.bind(node);
  const detach = source.attach(sink);
  return {source, sink, outgoing, deliver, detach};
};

describe('RpcTimelineSource: page to sink', () => {
  test('maps each runtime channel onto its sink method', () => {
    const {sink, deliver} = linkedSource();
    const events = [{type: 'x'}] as unknown as TimelineEvent[];
    const layer = {id: 'mine', label: 'Mine'} as unknown as TimelineLayer;
    const tree: InspectorMessage = {type: 'tree', roots: []};
    const incompatible = {
      tagName: 'x-a',
      reason: {code: 'observed-attributes-changed'},
    } as unknown as HmrIncompatibilityEvent;

    deliver('lit:timeline:push-event', {events});
    deliver('lit:timeline:custom-layer', {layer});
    deliver(INSPECT_DATA_CHANNEL, tree);
    deliver(HMR_INCOMPATIBLE_CHANNEL, incompatible);
    deliver('lit:timeline:runtime-ready', {});

    expect(sink.calls).toEqual([
      ['pushEvents', events],
      ['addLayer', layer],
      ['inspectorMessage', tree],
      ['hmrIncompatible', incompatible],
      ['runtimeReady', undefined],
    ]);
  });

  test('ignores malformed and unknown traffic instead of throwing', () => {
    const {sink, deliver} = linkedSource();
    deliver('lit:timeline:push-event', null);
    deliver('lit:timeline:push-event', {events: 'nope'});
    deliver('lit:timeline:custom-layer', {layer: {}});
    deliver('lit:timeline:custom-layer', undefined);
    deliver(INSPECT_DATA_CHANNEL, 'text');
    deliver(HMR_INCOMPATIBLE_CHANNEL, 7);
    deliver('lit:unrelated', {});
    // An empty batch still reaches the sink (which drops it); a bad one is
    // coerced to empty rather than crashing the handler.
    expect(sink.calls).toEqual([
      ['pushEvents', []],
      ['pushEvents', []],
    ]);
  });

  test('stops delivering once detached', () => {
    const {sink, deliver, detach} = linkedSource();
    detach();
    deliver('lit:timeline:runtime-ready', {});
    expect(sink.calls).toEqual([]);
  });
});

describe('RpcTimelineSource: server to page', () => {
  test('sends commands on the channels the runtime listens to', () => {
    const {source, outgoing} = linkedSource();
    source.setRecording(true);
    source.sendInspector({type: 'tree'});
    source.toggleOverlay();
    source.setSettingsOverride({flashUpdates: true});
    source.setLayers({...DEFAULT_LAYERS_STATE, mouseEventEnabled: true});

    expect(outgoing.map(([channel]) => channel)).toEqual([
      'lit:timeline:recording-changed',
      INSPECT_CMD_CHANNEL,
      INSPECT_OVERLAY_TOGGLE_CHANNEL,
      SETTINGS_OVERRIDE_CHANNEL,
      'lit:timeline:layers-changed',
    ]);
    expect(outgoing[0][1]).toEqual({recording: true});
    expect(outgoing[3][1]).toEqual({flashUpdates: true});
    // A flat map of the boolean toggles, not `{layers}` or the whole state.
    expect(outgoing[4][1]).toEqual({
      litLifecycleEnabled: DEFAULT_LAYERS_STATE.litLifecycleEnabled,
      litRenderEnabled: DEFAULT_LAYERS_STATE.litRenderEnabled,
      litRenderVerboseEnabled: DEFAULT_LAYERS_STATE.litRenderVerboseEnabled,
      litChangedValuesEnabled: DEFAULT_LAYERS_STATE.litChangedValuesEnabled,
      mouseEventEnabled: true,
      keyboardEventEnabled: DEFAULT_LAYERS_STATE.keyboardEventEnabled,
    });
  });

  test('drops commands made before it is bound', () => {
    const source = createRpcTimelineSource();
    expect(() => source.setRecording(true)).not.toThrow();
  });
});

// The devframe wiring around it, against a real node context.

let instance: DevframeInstance | undefined;
afterEach(async () => {
  await instance?.close();
  instance = undefined;
});

describe('createStandaloneLitDevframe', () => {
  test('registers page-send and routes a page message to the session', async () => {
    const def = createStandaloneLitDevframe({
      version: '9.9.9',
      features: () => null,
    });
    instance = initDevframe(def, {
      base: '/__lit/',
      distDir: false,
      ws: false,
      sse: false,
      getStorageDir: () => './node_modules/.tmp-lit-devframe-test',
    });
    const ctx = await instance.context;
    await instance.ready;
    expect(ctx.rpc.list()).toContain('lit:page-send');

    const roots = [{id: 1, tagName: 'x-a', children: []}];
    await ctx.rpc.invokeLocal('lit:page-send', INSPECT_DATA_CHANNEL, {
      type: 'tree',
      roots,
    });
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual(roots);
    // `lit-devtools.js` brings its own picker, so the panel offers Pick.
    expect((await ctx.rpc.invokeLocal('lit:get-meta')).picker).toBe(true);
  });
});

// The page half: the same channel over an RPC client.

const fakeRpc = () => {
  const called: unknown[][] = [];
  let receive!: (...args: any[]) => void;
  const rpc: PageRpc = {
    callEvent: (...args) => void called.push(args),
    register: (fn) => void (receive = fn.handler),
  };
  return {rpc, called, receive: (...args: unknown[]) => receive(...args)};
};

describe('createRpcTransport', () => {
  test('sends as page-send and receives page-receive by channel', () => {
    const {rpc, called, receive} = fakeRpc();
    const transport = createRpcTransport(rpc);
    const seen: unknown[] = [];
    const off = transport.on('lit:a', (d) => seen.push(d));
    transport.on('lit:b', () => seen.push('b'));

    transport.send('lit:x', {n: 1});
    receive('lit:a', 1);
    receive('lit:c', 'nobody listens');
    off();
    receive('lit:a', 2);

    expect(called).toEqual([['page-send', 'lit:x', {n: 1}]]);
    expect(seen).toEqual([1]);
  });

  test('a throwing listener does not starve the others', () => {
    const {rpc, receive} = fakeRpc();
    const transport = createRpcTransport(rpc);
    const seen: string[] = [];
    transport.on('lit:a', () => {
      throw new Error('boom');
    });
    transport.on('lit:a', () => seen.push('second'));
    const original = console.error;
    console.error = () => {};
    try {
      receive('lit:a', 1);
    } finally {
      console.error = original;
    }
    expect(seen).toEqual(['second']);
  });
});
