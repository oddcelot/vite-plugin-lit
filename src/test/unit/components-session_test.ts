import {describe, expect, test} from 'vite-plus/test';
import {
  ComponentsSession,
  LIVE_LS_KEY,
  findAncestors,
} from '../../panel/components-session.js';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';
import {
  MAX_HMR_INCOMPATIBILITIES,
  type HmrIncompatibilityEvent,
} from '../../types/hmr-incompatibility.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

/**
 * A session wired to recording ports. `sent` is every command the page was
 * sent, `events` the outward notices in order.
 */
const setup = (stored: Record<string, string> = {}) => {
  const sent: InspectorCommand[] = [];
  const events: string[] = [];
  const storage = memoryStorage(stored);
  const session = new ComponentsSession({
    send: (command) => sent.push(command),
    storage,
    onSelect: (id) => events.push(`select ${id}`),
    onPicked: () => events.push('picked'),
  });
  let changes = 0;
  session.subscribe(() => changes++);
  /** Commands sent since the last call. */
  const drain = () => sent.splice(0);
  return {session, storage, events, drain, changes: () => changes};
};

// <x-app id=1> > <x-list id=2> > <x-item id=3>
const tree: InspectorTreeNode[] = [
  {
    id: 1,
    tagName: 'x-app',
    children: [
      {
        id: 2,
        tagName: 'x-list',
        children: [{id: 3, tagName: 'x-item', children: []}],
      },
    ],
  },
];
const detailsFor = (id: number): InspectorDetails => ({
  id,
  tagName: 'x-item',
  attributes: [],
  properties: [],
  flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
});
const incompatible = (time: number): HmrIncompatibilityEvent => ({
  tagName: 'x-a',
  time,
  reason: {code: 'accessor-decorators'},
  action: 'reload',
});
const patch = (at: number): HmrPatchEvent => ({
  tagName: 'x-a',
  instances: 1,
  generation: 1,
  durationMs: 1,
  childState: 'transfer',
  at,
});

describe('connecting', () => {
  test('primes from the node side, then asks for a fresh tree and arms Live', () => {
    const {session, drain} = setup();
    session.connected({
      roots: tree,
      hmrIncompatibilities: [incompatible(1)],
      hmrHistory: [
        {kind: 'patched', at: 1, patch: patch(1)},
        {kind: 'incompatible', at: 2, incompatibility: incompatible(2)},
      ],
    });
    expect(session.roots).toBe(tree);
    expect(session.hmrIncompatibilities).toHaveLength(1);
    // The newest patch, skipping the failure after it.
    expect(session.lastPatch).toEqual(patch(1));
    expect(drain()).toEqual([{type: 'tree'}, {type: 'observe', enabled: true}]);
  });

  test('leaves Live off when it was paused last time', () => {
    const {session, drain} = setup({[LIVE_LS_KEY]: 'false'});
    expect(session.live).toBe(false);
    session.connected({roots: [], hmrIncompatibilities: []});
    expect(drain()).toEqual([{type: 'tree'}]);
  });
});

describe('selecting', () => {
  test('reveals the element, then asks for the tree, its details and a watch', () => {
    const {session, events, drain} = setup();
    session.connected({roots: tree, hmrIncompatibilities: []});
    drain();
    session.select(3);
    expect(events).toEqual(['select 3']);
    expect([...session.expanded]).toEqual([1, 2]);
    expect(drain()).toEqual([
      {type: 'tree'},
      {type: 'details', id: 3},
      {type: 'watch', id: 3},
    ]);
  });

  test('releases the previous watch first, and ignores reselecting', () => {
    const {session, events, drain} = setup();
    session.select(2);
    drain();
    session.select(3);
    expect(drain()[0]).toEqual({type: 'watch', id: null});
    session.select(3);
    expect(drain()).toEqual([]);
    expect(events).toEqual(['select 2', 'select 3']);
  });

  test('reveals a node the old tree did not have once the new tree arrives', () => {
    const {session} = setup();
    session.select(3);
    expect(session.expanded.size).toBe(0);
    session.receive({type: 'tree', roots: tree});
    expect([...session.expanded]).toEqual([1, 2]);
  });

  test('takes details and gone only for the selected element', () => {
    const {session} = setup();
    session.select(3);
    session.receive({type: 'details', details: detailsFor(9)});
    expect(session.details).toBeNull();
    session.receive({type: 'details', details: detailsFor(3)});
    expect(session.details).toEqual(detailsFor(3));
    session.receive({type: 'gone', id: 9});
    expect(session.gone).toBe(false);
    session.receive({type: 'gone', id: 3});
    expect(session).toMatchObject({details: null, gone: true});
  });

  test('a pick from the page selects it and brings the tab forward', () => {
    const {session, events, drain} = setup();
    session.togglePick();
    expect(session.picking).toBe(true);
    expect(drain()).toEqual([{type: 'pick'}]);
    session.receive({type: 'pick', id: 3});
    expect(session.picking).toBe(false);
    expect(session.selectedId).toBe(3);
    expect(events).toEqual(['select 3', 'picked']);
  });
});

describe('re-arming', () => {
  test('a ready re-sends the tree, the watch and Live', () => {
    const {session, drain} = setup();
    session.select(3);
    drain();
    session.receive({type: 'ready', litPackages: {lit: ['3.0.0']}});
    expect(session.runtime).toEqual({
      ready: true,
      litPackages: {lit: ['3.0.0']},
      topFrame: true,
    });
    expect(drain()).toEqual([
      {type: 'tree'},
      {type: 'watch', id: 3},
      {type: 'observe', enabled: true},
    ]);
  });

  test('a ready with nothing selected and Live paused only asks for the tree', () => {
    const {session, drain} = setup({[LIVE_LS_KEY]: 'false'});
    session.receive({type: 'ready'});
    expect(drain()).toEqual([{type: 'tree'}]);
  });

  test('a page change forgets the old page but keeps and re-watches the selection', () => {
    const {session, drain} = setup();
    session.connected({roots: tree, hmrIncompatibilities: [incompatible(1)]});
    session.hmrPatched(patch(1));
    session.select(3);
    session.receive({type: 'details', details: detailsFor(3)});
    drain();

    session.pageChanged();
    expect(session).toMatchObject({
      roots: [],
      hmrIncompatibilities: [],
      lastPatch: null,
      selectedId: 3,
      details: null,
      gone: false,
    });
    expect(drain()).toEqual([
      {type: 'tree'},
      {type: 'details', id: 3},
      {type: 'watch', id: 3},
    ]);
  });
});

describe('Live', () => {
  test('pausing is remembered and pulls one fresh tree; resuming re-arms', () => {
    const {session, storage, drain} = setup();
    session.toggleLive();
    expect(session.live).toBe(false);
    expect(storage.data.get(LIVE_LS_KEY)).toBe('false');
    expect(drain()).toEqual([
      {type: 'observe', enabled: false},
      {type: 'tree'},
    ]);
    session.toggleLive();
    expect(storage.data.get(LIVE_LS_KEY)).toBe('true');
    expect(drain()).toEqual([{type: 'observe', enabled: true}]);
  });

  test('leaving releases the watch and the observer', () => {
    const {session, drain} = setup();
    session.dispose();
    expect(drain()).toEqual([
      {type: 'watch', id: null},
      {type: 'observe', enabled: false},
    ]);
  });
});

test('HMR notices are capped like the node side', () => {
  const {session} = setup();
  for (let i = 0; i < MAX_HMR_INCOMPATIBILITIES + 5; i++) {
    session.hmrIncompatible(incompatible(i));
  }
  expect(session.hmrIncompatibilities).toHaveLength(MAX_HMR_INCOMPATIBILITIES);
  expect(session.hmrIncompatibilities.at(-1)?.time).toBe(
    MAX_HMR_INCOMPATIBILITIES + 4
  );
});

test('tells subscribers about every change, and not about ignored messages', () => {
  const {session, changes} = setup();
  session.select(3);
  session.toggleExpand(1);
  const before = changes();
  session.receive({type: 'details', details: detailsFor(9)});
  expect(changes()).toBe(before);
  session.receive({type: 'details', details: detailsFor(3)});
  expect(changes()).toBe(before + 1);
});

test('findAncestors lists the path to an element, or null when absent', () => {
  expect(findAncestors(tree, 3)).toEqual([1, 2]);
  expect(findAncestors(tree, 1)).toEqual([]);
  expect(findAncestors(tree, 42)).toBeNull();
});
