import {describe, expect, test, vi} from 'vite-plus/test';
import {
  createFollowedPage,
  type FollowedPageEffects,
  type HmrDiagnostic,
} from '../../lib/devframe/followed-page.js';
import type {PageChangedEvent} from '../../lib/devframe/protocol.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';
import type {
  InspectorDetails,
  InspectorMessage,
  InspectorTreeNode,
} from '../../types/inspector.js';
import {
  DEFAULT_LAYERS_STATE,
  type SettingsOverride,
  type TimelineEvent,
  type TimelineLayer,
  type TimelineLayersState,
} from '../../types/timeline.js';

/**
 * Drives the followed page's sink the way a page runtime would and records
 * every effect and runtime push, so each rule is checked without booting a
 * devframe. `devframe_test.ts` checks that the effects reach the right RPC
 * broadcasts and stores.
 */
const setup = (
  options: {
    recording?: boolean;
    override?: () => Promise<SettingsOverride | undefined>;
  } = {}
) => {
  let layers: TimelineLayersState = {
    ...DEFAULT_LAYERS_STATE,
    recordingState: options.recording ?? false,
  };
  const out = {
    events: [] as TimelineEvent[][],
    layers: [] as TimelineLayer[],
    inspector: [] as InspectorMessage[],
    pageChanged: [] as PageChangedEvent[],
    patched: [] as HmrPatchEvent[],
    incompatible: [] as HmrIncompatibilityEvent[],
    diagnostics: [] as HmrDiagnostic[],
    // What the page runtime was told.
    setRecording: [] as boolean[],
    setLayers: [] as TimelineLayersState[],
    overrides: [] as SettingsOverride[],
    // Interleaved order of the requester and the inspector broadcast.
    order: [] as string[],
  };
  const effects: FollowedPageEffects = {
    events: (stamped) => out.events.push(stamped),
    layerAdded: (layer) => out.layers.push(layer),
    inspectorMessage: (message) => {
      out.order.push('broadcast');
      out.inspector.push(message);
    },
    pageChanged: (change) => out.pageChanged.push(change),
    hmrPatched: (event) => out.patched.push(event),
    hmrIncompatible: (event) => out.incompatible.push(event),
    diagnose: (diagnostic) => out.diagnostics.push(diagnostic),
    readOverride: options.override ?? (async () => undefined),
  };
  const page = createFollowedPage({
    effects,
    runtime: {
      setRecording: (r) => out.setRecording.push(r),
      setLayers: (l) => out.setLayers.push(l),
      setSettingsOverride: (o) => out.overrides.push(o),
    },
    requester: {
      resolve: (message) => {
        // The cache must not have taken the message yet.
        out.order.push(
          message.type === 'tree' && page.roots() === message.roots
            ? 'resolve-after-cache'
            : 'resolve'
        );
      },
    },
    layers: () => layers,
    epoch: 'e',
    now: () => 42,
  });
  const setLayers = (next: Partial<TimelineLayersState>) => {
    layers = {...layers, ...next};
    page.layersChanged(layers);
  };
  return {page, sink: page.sink, out, setLayers};
};

const treeNode: InspectorTreeNode = {id: 3, tagName: 'x-a', children: []};
const detailsFor = (id: number): InspectorDetails => ({
  id,
  tagName: 'x-a',
  attributes: [],
  properties: [],
  flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
});
const pageEvent = (time: number): TimelineEvent => ({
  layerId: 'lit-render',
  time,
  data: {},
});
const patch = (at: number): HmrPatchEvent => ({
  tagName: 'x-a',
  instances: 1,
  generation: 1,
  durationMs: 1,
  childState: 'transfer',
  at,
});
const incompatible = (
  reason: HmrIncompatibilityEvent['reason'],
  time = 2
): HmrIncompatibilityEvent => ({
  tagName: 'x-a',
  time,
  reason,
  action: 'reload',
});
const layer: TimelineLayer = {id: 'mine', label: 'Mine', color: 0xffffff};

describe('followed page', () => {
  describe('page switches', () => {
    test('a ready from the page already followed keeps its buffer', () => {
      const {page, sink, out} = setup();
      sink.runtimeReady('a');
      sink.pushEvents([pageEvent(1), pageEvent(2)], 'a');
      sink.runtimeReady('a');
      expect(page.history()).toHaveLength(2);
      expect(out.pageChanged).toEqual([]);
    });

    test('a ready from another page clears the buffer and says so', () => {
      const {page, sink, out} = setup();
      sink.runtimeReady('a');
      sink.pushEvents([pageEvent(1), pageEvent(2)], 'a');
      sink.runtimeReady('b');
      expect(page.history()).toEqual([]);
      expect(page.activePageId()).toBe('b');
      expect(out.pageChanged).toEqual([
        {previousPageId: 'a', pageId: 'b', reload: false, at: 42},
      ]);
    });

    test('the first page to announce itself is not a change', () => {
      const {sink, out} = setup();
      sink.runtimeReady('a', 'tab-1');
      expect(out.pageChanged).toEqual([]);
    });

    test('a new page in the same tab is a reload', () => {
      const {sink, out} = setup();
      sink.runtimeReady('a', 'tab-1');
      sink.runtimeReady('b', 'tab-1');
      sink.runtimeReady('c', 'tab-2');
      expect(out.pageChanged).toMatchObject([
        {previousPageId: 'a', pageId: 'b', reload: true},
        {previousPageId: 'b', pageId: 'c', reload: false},
      ]);
    });

    test('a ready from another page forgets the cached tree, details and HMR history', () => {
      const {page, sink} = setup();
      sink.runtimeReady('a');
      sink.inspectorMessage({type: 'tree', roots: [treeNode]}, 'a');
      sink.inspectorMessage({type: 'details', details: detailsFor(1)}, 'a');
      sink.hmrPatched(patch(1), 'a');
      sink.hmrIncompatible(incompatible({code: 'accessor-decorators'}), 'a');

      // A reconnect of the same page keeps them.
      sink.runtimeReady('a');
      expect(page.roots()).toEqual([treeNode]);
      expect(page.hmrHistory()).toHaveLength(2);

      sink.runtimeReady('b');
      expect(page.roots()).toEqual([]);
      expect(page.details(1)).toBeNull();
      expect(page.hmrHistory()).toEqual([]);
      expect(page.hmrIncompatibilities()).toEqual([]);
    });

    test('a runtime without a page id clears its buffer but is never filtered', () => {
      const {page, sink, out} = setup();
      sink.runtimeReady(undefined);
      sink.pushEvents([pageEvent(1)]);
      // An older runtime gives no way to tell a reconnect from a new page,
      // so every ready is treated as a new clock.
      sink.runtimeReady(undefined);
      sink.pushEvents([pageEvent(2)]);
      expect(page.history()).toHaveLength(1);
      sink.inspectorMessage({type: 'tree', roots: [treeNode]});
      expect(page.roots()).toEqual([treeNode]);
      expect(out.pageChanged).toEqual([]);
    });
  });

  describe('traffic from a page that is not followed', () => {
    test('is dropped before it reaches the caches or the panel', () => {
      const {page, sink, out} = setup();
      sink.runtimeReady('a');
      sink.runtimeReady('b');
      sink.pushEvents([pageEvent(1)], 'a');
      sink.inspectorMessage({type: 'tree', roots: [treeNode]}, 'a');
      sink.inspectorMessage({type: 'pick', id: 3}, 'a');
      sink.addLayer(layer, 'a');
      sink.hmrPatched(patch(1), 'a');
      sink.hmrIncompatible(incompatible({code: 'accessor-decorators'}), 'a');

      expect(page.history()).toEqual([]);
      expect(page.roots()).toEqual([]);
      expect(page.hmrHistory()).toEqual([]);
      expect(out).toMatchObject({
        events: [],
        layers: [],
        inspector: [],
        patched: [],
        incompatible: [],
        diagnostics: [],
        order: [],
      });
    });

    test('from the followed page passes through', () => {
      const {page, sink, out} = setup();
      sink.runtimeReady('a');
      sink.runtimeReady('b');
      sink.pushEvents([pageEvent(2)], 'b');
      sink.inspectorMessage({type: 'tree', roots: [treeNode]}, 'b');
      sink.addLayer(layer, 'b');
      expect(page.history()).toHaveLength(1);
      expect(page.roots()).toEqual([treeNode]);
      expect(out.layers).toEqual([layer]);
    });

    test('a stale page cannot answer an agent query', () => {
      const {sink, out} = setup();
      sink.runtimeReady('a');
      sink.runtimeReady('b');
      sink.inspectorMessage({type: 'tree', roots: [treeNode]}, 'a');
      expect(out.order).toEqual([]);
    });
  });

  test('stamps events with ids before streaming them', () => {
    const {sink, out} = setup();
    sink.pushEvents([pageEvent(1), pageEvent(2)]);
    sink.pushEvents([]);
    expect(out.events).toEqual([
      [
        {...pageEvent(1), id: 'e-0'},
        {...pageEvent(2), id: 'e-1'},
      ],
    ]);
  });

  test('resolves waiting agent queries before the cache takes the message, then tells the panel', () => {
    const {page, sink, out} = setup();
    sink.inspectorMessage({type: 'tree', roots: [treeNode]});
    expect(out.order).toEqual(['resolve', 'broadcast']);
    expect(page.roots()).toEqual([treeNode]);
  });

  describe('replay to a runtime that just booted', () => {
    test('sends the current layers and recording state', () => {
      const {sink, out} = setup({recording: true});
      sink.runtimeReady('a');
      expect(out.setRecording).toEqual([true]);
      expect(out.setLayers.at(-1)?.recordingState).toBe(true);
    });

    test('sends the stored settings override', async () => {
      const {sink, out} = setup({
        override: async () => ({flashUpdates: true}),
      });
      sink.runtimeReady('a');
      await vi.waitFor(() =>
        expect(out.overrides).toEqual([{flashUpdates: true}])
      );
    });

    test('sends no override when none is stored, or the read fails', async () => {
      const empty = setup({override: async () => ({})});
      const failing = setup({
        override: async () => {
          throw new Error('store unreadable');
        },
      });
      empty.sink.runtimeReady('a');
      failing.sink.runtimeReady('a');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(empty.out.overrides).toEqual([]);
      expect(failing.out.overrides).toEqual([]);
    });
  });

  describe('layers changing', () => {
    test('reach the runtime', () => {
      const {out, setLayers} = setup();
      setLayers({mouseEventEnabled: false});
      expect(out.setRecording).toEqual([false]);
      expect(out.setLayers.at(-1)?.mouseEventEnabled).toBe(false);
    });

    test('clear the buffer when recording starts, not when it stops', () => {
      const {page, sink, setLayers} = setup();
      setLayers({recordingState: true});
      sink.pushEvents([pageEvent(4000)]);
      // Stopping keeps the recording readable; that is the point of stopping.
      setLayers({recordingState: false});
      expect(page.history()).toHaveLength(1);
      // Starting again re-zeroes the page's clock.
      setLayers({recordingState: true});
      expect(page.history()).toEqual([]);
    });

    test('stamp the queries with whether recording is on', () => {
      const {page, setLayers} = setup();
      expect(page.query({}).recording).toBe(false);
      setLayers({recordingState: true});
      expect(page.query({}).recording).toBe(true);
      expect(page.summarize({}).recording).toBe(true);
    });
  });

  test('a recording already on at boot is not a rising edge', () => {
    const {page, sink, setLayers} = setup({recording: true});
    sink.pushEvents([pageEvent(1)]);
    setLayers({recordingState: true});
    expect(page.history()).toHaveLength(1);
  });

  test.each([
    [
      {code: 'accessor-decorators'} as const,
      {code: 'LIT_HMR_ACCESSOR', tagName: 'x-a'},
    ],
    [
      {code: 'patch-failed', detail: 'boom'} as const,
      {code: 'LIT_HMR_PATCH_FAILED', tagName: 'x-a', detail: 'boom'},
    ],
    [
      {code: 'observed-attributes-changed'} as const,
      {code: 'LIT_HMR_ATTRS_CHANGED', tagName: 'x-a'},
    ],
  ])(
    'echoes an HMR incompatibility (%o) to the terminal',
    (reason, diagnostic) => {
      const {page, sink, out} = setup();
      const event = incompatible(reason);
      sink.hmrIncompatible(event);
      expect(out.incompatible).toEqual([event]);
      expect(out.diagnostics).toEqual([diagnostic]);
      expect(page.hmrIncompatibilities()).toEqual([event]);
    }
  );

  test('records and reports a patch from the followed page', () => {
    const {page, sink, out} = setup();
    sink.runtimeReady('a');
    sink.hmrPatched(patch(1), 'a');
    sink.hmrPatched(patch(2), 'other-tab');
    expect(out.patched).toEqual([patch(1)]);
    expect(page.hmrHistory().map((e) => e.at)).toEqual([1]);
  });
});
