import {describe, expect, test} from 'vite-plus/test';
import {
  capTail,
  createRecordingSession,
  sinceWindow,
} from '../../lib/devframe/session.js';
import {RECENT_EVENTS_BUFFER_SIZE} from '../../lib/devframe/protocol.js';
import {MAX_HMR_INCOMPATIBILITIES} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {MAX_HMR_PATCHES} from '../../types/hmr-patch.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';
import type {InspectorTreeNode} from '../../types/inspector.js';
import type {SessionSnapshot} from '../../types/snapshot.js';
import type {TimelineEvent} from '../../types/timeline.js';

const ev = (
  time: number,
  extra: Partial<TimelineEvent> = {}
): TimelineEvent => ({layerId: 'lit-render', time, data: {}, ...extra});

const hmr = (n: number): HmrIncompatibilityEvent =>
  ({
    tagName: `x-${n}`,
    reason: {code: 'attributes-changed'},
  }) as unknown as HmrIncompatibilityEvent;

const patch = (
  n: number,
  extra: Partial<HmrPatchEvent> = {}
): HmrPatchEvent => ({
  tagName: `x-${n}`,
  instances: 1,
  generation: 1,
  durationMs: 1,
  childState: 'transfer',
  at: n,
  ...extra,
});

describe('capTail', () => {
  test('drops the oldest entries and leaves a short list alone', () => {
    const a = [1, 2, 3, 4];
    capTail(a, 2);
    expect(a).toEqual([3, 4]);
    capTail(a, 5);
    expect(a).toEqual([3, 4]);
  });
});

describe('sinceWindow', () => {
  test('measures against the newest event of the whole buffer', () => {
    const buffer = [ev(0, {layerId: 'a'}), ev(10_000, {layerId: 'b'})];
    const onlyA = buffer.filter((e) => e.layerId === 'a');
    // The matching event is 10s stale relative to the buffer, not to itself.
    expect(sinceWindow(onlyA, buffer, 1000)).toEqual([]);
    expect(sinceWindow(onlyA, buffer, 10_000)).toEqual(onlyA);
  });

  test('is a no-op without a window or without events', () => {
    const buffer = [ev(5)];
    expect(sinceWindow(buffer, buffer, undefined)).toBe(buffer);
    expect(sinceWindow([], [], 100)).toEqual([]);
  });
});

describe('push', () => {
  test('stamps epoch-seq ids, monotonic across clear, keeping existing ids', () => {
    const s = createRecordingSession({epoch: 'e1'});
    const out = s.push([ev(1), ev(2, {id: 'keep'}), ev(3)]);
    expect(out.map((e) => e.id)).toEqual(['e1-0', 'keep', 'e1-1']);
    s.clear();
    expect(s.history()).toEqual([]);
    expect(s.push([ev(4)])[0]!.id).toBe('e1-2');
  });

  test('caps the buffer at RECENT_EVENTS_BUFFER_SIZE, oldest first', () => {
    const s = createRecordingSession({epoch: 'e'});
    s.push(
      Array.from({length: RECENT_EVENTS_BUFFER_SIZE + 5}, (_, i) => ev(i))
    );
    const kept = s.history();
    expect(kept).toHaveLength(RECENT_EVENTS_BUFFER_SIZE);
    expect(kept[0]!.time).toBe(5);
  });
});

describe('rising edge', () => {
  test('clears only when recording turns on', () => {
    const s = createRecordingSession({recording: false});
    s.push([ev(1)]);
    s.setRecording(false);
    expect(s.history()).toHaveLength(1);
    s.setRecording(true);
    expect(s.history()).toHaveLength(0);
    s.push([ev(2)]);
    s.setRecording(true);
    expect(s.history()).toHaveLength(1);
    // Falling edge keeps what was recorded: it is what the user reads next.
    s.setRecording(false);
    expect(s.history()).toHaveLength(1);
    s.setRecording(true);
    expect(s.history()).toHaveLength(0);
  });

  test('starting already recording makes the first true a non-edge', () => {
    const s = createRecordingSession({recording: true});
    s.push([ev(1)]);
    s.setRecording(true);
    expect(s.history()).toHaveLength(1);
  });
});

describe('query', () => {
  const seed = () => {
    const s = createRecordingSession({epoch: 'e'});
    s.push([
      ev(0, {layerId: 'a', meta: {elementId: 1}}),
      ev(5000, {layerId: 'b', meta: {elementId: 2}}),
      ev(9000, {layerId: 'a', meta: {elementId: 1}}),
      ev(10_000, {layerId: 'b', meta: {elementId: 2}}),
    ]);
    return s;
  };

  test('filters by layer and element, and reports the recording flag', () => {
    const s = seed();
    expect(s.query({layerId: 'a'}, true).events.map((e) => e.time)).toEqual([
      0, 9000,
    ]);
    expect(s.query({elementId: 2}, false)).toMatchObject({
      recording: false,
      bufferSize: 4,
      truncated: false,
    });
  });

  test('filters by tag name, case-insensitively', () => {
    const s = createRecordingSession({epoch: 'e'});
    s.push([
      ev(0, {meta: {elementId: 1, tagName: 'x-foo'}}),
      ev(1, {meta: {elementId: 2, tagName: 'x-bar'}}),
      ev(2, {}),
      ev(3, {meta: {elementId: 3, tagName: 'x-foo'}}),
    ]);
    expect(s.query({tagName: 'X-Foo'}, true).events.map((e) => e.time)).toEqual(
      [0, 3]
    );
  });

  test('tagName combines with elementId and sinceMs, and may match nothing', () => {
    const s = createRecordingSession({epoch: 'e'});
    s.push([
      ev(0, {meta: {elementId: 1, tagName: 'x-foo'}}),
      ev(900, {meta: {elementId: 2, tagName: 'x-foo'}}),
      ev(950, {meta: {elementId: 2, tagName: 'x-foo'}}),
      ev(1000, {meta: {elementId: 3, tagName: 'x-bar'}}),
    ]);
    expect(
      s
        .query({tagName: 'x-foo', elementId: 2, sinceMs: 100}, true)
        .events.map((e) => e.time)
    ).toEqual([900, 950]);
    // The window is measured against the newest event of the whole buffer.
    expect(s.query({tagName: 'x-foo', sinceMs: 10}, true).events).toEqual([]);
    expect(s.query({tagName: 'x-none'}, true)).toMatchObject({
      events: [],
      truncated: false,
    });
  });

  test('sinceMs is relative to the newest buffered event, not the match', () => {
    const s = seed();
    expect(s.query({sinceMs: 1000}, true).events.map((e) => e.time)).toEqual([
      9000, 10_000,
    ]);
    // Element 1 last fired at 9000; the window still starts at 10000 - 500.
    expect(s.query({elementId: 1, sinceMs: 500}, true).events).toEqual([]);
  });

  test('limit defaults to 50, is capped at 200 and flags truncation', () => {
    const s = createRecordingSession({epoch: 'e'});
    s.push(Array.from({length: 300}, (_, i) => ev(i)));
    const dflt = s.query({}, true);
    expect(dflt.events).toHaveLength(50);
    expect(dflt.truncated).toBe(true);
    expect(dflt.events[49]!.time).toBe(299);
    expect(s.query({limit: 10_000}, true).events).toHaveLength(200);
    expect(s.query({limit: 3}, true).events.map((e) => e.time)).toEqual([
      297, 298, 299,
    ]);
  });

  test('a replayed session answers up to the whole buffer by default', () => {
    const replay: SessionSnapshot = {
      capturedAt: 'then',
      version: '1',
      customLayers: [],
      roots: [],
      details: [],
      hmrIncompatibilities: [],
      events: Array.from({length: 300}, (_, i) => ev(i, {id: `r-${i}`})),
    };
    const s = createRecordingSession({replay});
    const result = s.query({}, false);
    expect(result.events).toHaveLength(300);
    expect(result.truncated).toBe(false);
    // Replayed ids survive, and new pushes continue to stamp.
    expect(result.events[0]!.id).toBe('r-0');
    expect(s.query({limit: 10_000}, false).events.length).toBeLessThanOrEqual(
      RECENT_EVENTS_BUFFER_SIZE
    );
  });
});

describe('summarize', () => {
  const phase = (
    edge: 'start' | 'end',
    time: number,
    tick: number
  ): TimelineEvent => ({
    layerId: 'lit-lifecycle',
    time,
    groupId: `1:${tick}`,
    title: `performUpdate:${edge}`,
    subtitle: 'my-el',
    data: {phase: 'performUpdate'},
    meta: {elementId: 1, tagName: 'my-el'},
  });

  test('applies the same window as query and caps cycles, not totals', () => {
    const s = createRecordingSession({epoch: 'e'});
    s.push([
      phase('start', 0, 1),
      phase('end', 4, 1),
      phase('start', 9000, 2),
      phase('end', 9010, 2),
    ]);
    const all = s.summarize({}, true);
    expect(all.recording).toBe(true);
    expect(all.bufferSize).toBe(4);
    expect(all.cycles).toHaveLength(2);

    const recent = s.summarize({sinceMs: 1000}, true);
    expect(recent.cycles).toHaveLength(1);
    expect(recent.bufferSize).toBe(4);

    const capped = s.summarize({limit: 1}, true);
    expect(capped.cycles).toHaveLength(1);
    expect(capped.truncated).toBe(true);
    expect(capped.components).toEqual(all.components);

    expect(s.summarize({tagName: 'other'}, true).cycles).toEqual([]);
  });
});

describe('hmr incompatibilities', () => {
  test('keeps the newest MAX_HMR_INCOMPATIBILITIES', () => {
    const s = createRecordingSession();
    for (let i = 0; i < MAX_HMR_INCOMPATIBILITIES + 3; i++) {
      s.pushHmrIncompatibility(hmr(i));
    }
    const kept = s.hmrIncompatibilities();
    expect(kept).toHaveLength(MAX_HMR_INCOMPATIBILITIES);
    expect(kept[0]!.tagName).toBe('x-3');
  });
});

describe('hmr patches', () => {
  test('keeps the newest MAX_HMR_PATCHES', () => {
    const s = createRecordingSession();
    for (let i = 0; i < MAX_HMR_PATCHES + 3; i++) s.pushHmrPatch(patch(i));
    const kept = s.hmrPatches();
    expect(kept).toHaveLength(MAX_HMR_PATCHES);
    expect(kept[0]!.tagName).toBe('x-3');
  });

  test('survives clear() and the recording rising edge', () => {
    const s = createRecordingSession();
    s.pushHmrPatch(patch(1));
    s.clear();
    s.setRecording(true);
    s.setRecording(false);
    s.setRecording(true);
    expect(s.hmrPatches()).toHaveLength(1);
  });

  test('fills the file from the cached tree, never over a given one', () => {
    const s = createRecordingSession();
    const source = {file: 'src/x-1.ts', line: 3, column: 1};
    s.applyInspector({
      type: 'tree',
      roots: [
        {
          id: 1,
          tagName: 'x-outer',
          children: [{id: 2, tagName: 'x-1', source, children: []}],
        },
      ] as InspectorTreeNode[],
    });
    s.pushHmrPatch(patch(1));
    s.pushHmrPatch(patch(1, {file: 'given.ts'}));
    s.pushHmrPatch(patch(2));
    expect(s.hmrPatches().map((p) => p.file)).toEqual([
      'src/x-1.ts',
      'given.ts',
      undefined,
    ]);
  });

  test('hmrHistory merges both lists by timestamp, patches first on a tie', () => {
    const s = createRecordingSession();
    s.pushHmrPatch(patch(20));
    s.pushHmrIncompatibility({...hmr(1), time: 10});
    s.pushHmrPatch(patch(30));
    s.pushHmrIncompatibility({...hmr(2), time: 30});
    expect(s.hmrHistory().map((e) => [e.kind, e.at])).toEqual([
      ['incompatible', 10],
      ['patched', 20],
      ['patched', 30],
      ['incompatible', 30],
    ]);
  });

  test('capture includes the patches and replay round-trips them', () => {
    const s = createRecordingSession();
    s.pushHmrPatch(patch(1));
    const snap = s.capture({capturedAt: 't', version: 'v', customLayers: []});
    expect(snap.hmrPatches).toEqual([patch(1)]);
    expect(createRecordingSession({replay: snap}).hmrPatches()).toEqual([
      patch(1),
    ]);
  });

  test('a snapshot from before patches were recorded replays empty', () => {
    const replay: SessionSnapshot = {
      capturedAt: 'then',
      version: '1',
      customLayers: [],
      roots: [],
      details: [],
      hmrIncompatibilities: [],
      events: [],
    };
    expect(createRecordingSession({replay}).hmrPatches()).toEqual([]);
  });
});

describe('pageReady', () => {
  test('folds a ready into first, same, switched or legacy', () => {
    const s = createRecordingSession();
    expect(s.pageReady(undefined)).toBe('legacy');
    expect(s.activePageId()).toBeUndefined();
    expect(s.pageReady('a')).toBe('first');
    expect(s.pageReady('a')).toBe('same');
    expect(s.pageReady('b')).toBe('switched');
    expect(s.activePageId()).toBe('b');
    // An older runtime reporting in does not unseat the followed page.
    expect(s.pageReady(undefined)).toBe('legacy');
    expect(s.activePageId()).toBe('b');
  });

  test('tracks the tab of the followed page', () => {
    const s = createRecordingSession();
    s.pageReady('a', 't1');
    expect(s.activeTabId()).toBe('t1');
    s.pageReady('b', 't1');
    expect(s.activeTabId()).toBe('t1');
    s.pageReady('c', 't2');
    expect(s.activeTabId()).toBe('t2');
  });

  test('accepts only the active page, plus unstamped traffic', () => {
    const s = createRecordingSession();
    // No page followed yet: nothing to compare against.
    expect(s.accepts('a')).toBe(true);
    s.pageReady('a');
    s.pageReady('b');
    expect(s.accepts('a')).toBe(false);
    expect(s.accepts('b')).toBe(true);
    expect(s.accepts(undefined)).toBe(true);
  });
});

describe('inspector caches and capture', () => {
  test('tree replaces, details accumulate and gone evicts', () => {
    const s = createRecordingSession();
    const details = {id: 7} as never;
    s.applyInspector({type: 'tree', roots: [{id: 1}] as never});
    s.applyInspector({type: 'details', details});
    expect(s.roots()).toEqual([{id: 1}]);
    expect(s.details(7)).toBe(details);
    expect(s.details(8)).toBeNull();
    s.applyInspector({type: 'gone', id: 7});
    expect(s.details(7)).toBeNull();
  });

  test('runtime defaults to not ready and follows each ready message', () => {
    const s = createRecordingSession();
    expect(s.runtime()).toEqual({
      ready: false,
      litPackages: {},
      topFrame: true,
      chromeTracks: true,
    });

    s.applyInspector({
      type: 'ready',
      litPackages: {'lit-element': ['4.2.2', '4.1.0']},
      topFrame: false,
    });
    expect(s.runtime()).toEqual({
      ready: true,
      litPackages: {'lit-element': ['4.2.2', '4.1.0']},
      topFrame: false,
      chromeTracks: true,
    });

    // A page reload with fewer copies replaces the announcement.
    s.applyInspector({
      type: 'ready',
      litPackages: {'lit-element': ['4.2.2']},
      topFrame: true,
    });
    expect(s.runtime()).toEqual({
      ready: true,
      litPackages: {'lit-element': ['4.2.2']},
      topFrame: true,
      chromeTracks: true,
    });
  });

  test('a bare ready from an older runtime reads as ready, nothing known', () => {
    const s = createRecordingSession();
    s.applyInspector({type: 'ready'});
    expect(s.runtime()).toEqual({
      ready: true,
      litPackages: {},
      topFrame: true,
      chromeTracks: true,
    });
  });

  test('a runtime in a browser without Chrome tracks says so', () => {
    const s = createRecordingSession();
    s.applyInspector({type: 'ready', chromeTracks: false});
    expect(s.runtime().chromeTracks).toBe(false);
  });

  test('capture freezes the buffers and replay round-trips it', () => {
    const s = createRecordingSession({epoch: 'e'});
    s.push([ev(1)]);
    s.pushHmrIncompatibility(hmr(1));
    s.applyInspector({type: 'tree', roots: [{id: 1}] as never});
    const snap = s.capture({capturedAt: 't', version: 'v', customLayers: []});
    expect(snap).toMatchObject({capturedAt: 't', version: 'v'});
    expect(snap.events.map((e) => e.id)).toEqual(['e-0']);
    expect(snap.hmrIncompatibilities).toHaveLength(1);

    s.push([ev(2)]);
    expect(snap.events).toHaveLength(1);

    const again = createRecordingSession({replay: snap});
    expect(again.history()).toEqual(snap.events);
    expect(again.roots()).toEqual(snap.roots);
  });
});
