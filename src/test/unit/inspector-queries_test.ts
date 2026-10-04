import {describe, expect, test, vi} from 'vite-plus/test';
import {
  createInspectorQueries,
  findByTag,
  pruneTree,
} from '../../lib/devframe/inspector-queries.js';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';

const detailsFor = (id: number): InspectorDetails => ({
  id,
  tagName: 'x-item',
  attributes: [],
  properties: [],
  flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
});

/**
 * Queries over a page that only answers what the test tells it to, with a
 * cache the test fills. `sent` is every ask the page received.
 */
const setup = (options: {live?: boolean; roots?: InspectorTreeNode[]} = {}) => {
  const sent: InspectorCommand[] = [];
  const cached = new Map<number, InspectorDetails>();
  const queries = createInspectorQueries({
    source: {sendInspector: (command) => sent.push(command)},
    cache: {
      roots: () => options.roots ?? [],
      details: (id) => cached.get(id) ?? null,
    },
    live: options.live ?? true,
    timeoutMs: 1000,
  });
  return {queries, sent, cached};
};

const tree: InspectorTreeNode[] = [
  {
    id: 1,
    tagName: 'x-app',
    children: [
      {id: 2, tagName: 'x-item', children: []},
      {id: 3, tagName: 'X-ITEM', children: []},
    ],
  },
];

describe('a live page', () => {
  test('is asked for its tree, and its answer wins', async () => {
    const {queries, sent} = setup({roots: []});
    const pending = queries.tree();
    expect(sent).toEqual([{type: 'tree'}]);
    queries.resolve({type: 'tree', roots: tree});
    expect(await pending).toEqual(tree);
  });

  test('that says an element is gone beats the cache', async () => {
    const {queries, cached} = setup();
    cached.set(2, detailsFor(2));
    const pending = queries.details({id: 2});
    queries.resolve({type: 'gone', id: 2});
    expect(await pending).toBeNull();
  });

  test('that stays silent is answered from the cache', async () => {
    vi.useFakeTimers();
    try {
      const {queries, cached} = setup({roots: tree});
      cached.set(2, detailsFor(2));
      const roots = queries.tree();
      const details = queries.details({id: 2});
      await vi.advanceTimersByTimeAsync(1000);
      expect(await roots).toEqual(tree);
      expect(await details).toEqual(detailsFor(2));
    } finally {
      vi.useRealTimers();
    }
  });

  test('by tag, reads every match and lists the ones it could not', async () => {
    const {queries, sent} = setup();
    const pending = queries.details({tagName: 'x-item'});
    queries.resolve({type: 'tree', roots: tree});
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.slice(1)).toEqual([
      {type: 'details', id: 2},
      {type: 'details', id: 3},
    ]);
    queries.resolve({type: 'details', details: detailsFor(2)});
    queries.resolve({type: 'gone', id: 3});
    expect(await pending).toEqual({
      details: [detailsFor(2)],
      missing: [3],
      truncated: false,
    });
  });
});

test('without a live page, the cache is the answer and nothing is asked', async () => {
  const {queries, sent, cached} = setup({live: false, roots: tree});
  cached.set(2, detailsFor(2));
  expect(await queries.tree()).toEqual(tree);
  expect(await queries.details({tagName: 'x-item'})).toEqual({
    details: [detailsFor(2)],
    missing: [3],
    truncated: false,
  });
  expect(sent).toEqual([]);
});

test('maxDepth bounds the tree; an unusable one returns it whole', async () => {
  const {queries} = setup({live: false, roots: tree});
  expect(await queries.tree({maxDepth: 1})).toEqual([
    {id: 1, tagName: 'x-app', children: [], hiddenChildren: 2},
  ]);
  expect(await queries.tree({maxDepth: 0})).toEqual(tree);
  expect(await queries.tree({maxDepth: Number.NaN})).toEqual(tree);
});

describe('findByTag', () => {
  const node = (
    id: number,
    tagName: string,
    children: InspectorTreeNode[] = []
  ): InspectorTreeNode => ({id, tagName, children});
  const tree = [
    node(1, 'x-app', [
      node(2, 'x-item', [node(3, 'x-other'), node(4, 'x-item')]),
      node(5, 'x-list', [node(6, 'x-ITEM')]),
    ]),
    node(7, 'x-item'),
  ];

  test('walks depth-first and matches case-insensitively', () => {
    expect(findByTag(tree, 'X-Item')).toEqual({
      ids: [2, 4, 6, 7],
      truncated: false,
    });
  });

  test('an unknown tag matches nothing', () => {
    expect(findByTag(tree, 'x-none')).toEqual({ids: [], truncated: false});
  });

  test('limit cuts the matches and flags truncation', () => {
    expect(findByTag(tree, 'x-item', 2)).toEqual({
      ids: [2, 4],
      truncated: true,
    });
    expect(findByTag(tree, 'x-item', 4).truncated).toBe(false);
  });

  test('limit defaults to 20 and is capped at 50', () => {
    const many = Array.from({length: 60}, (_, i) => node(i, 'x-row'));
    expect(findByTag(many, 'x-row').ids).toHaveLength(20);
    expect(findByTag(many, 'x-row', 1000)).toMatchObject({truncated: true});
    expect(findByTag(many, 'x-row', 1000).ids).toHaveLength(50);
    expect(findByTag(many, 'x-row', Number.NaN).ids).toHaveLength(20);
    expect(findByTag(many, 'x-row', 0).ids).toHaveLength(20);
  });
});

describe('pruneTree', () => {
  const tree = (): InspectorTreeNode[] => [
    {
      id: 1,
      tagName: 'x-app',
      children: [
        {
          id: 2,
          tagName: 'x-a',
          children: [{id: 3, tagName: 'x-leaf', children: []}],
        },
        {id: 4, tagName: 'x-b', children: []},
      ],
    },
  ];

  test('depth 1 keeps the roots and counts what it dropped', () => {
    expect(pruneTree(tree(), 1)).toEqual([
      {id: 1, tagName: 'x-app', children: [], hiddenChildren: 2},
    ]);
  });

  test('depth 2 leaves childless nodes without hiddenChildren', () => {
    const [app] = pruneTree(tree(), 2);
    expect(app!.hiddenChildren).toBeUndefined();
    expect(app!.children).toEqual([
      {id: 2, tagName: 'x-a', children: [], hiddenChildren: 1},
      {id: 4, tagName: 'x-b', children: []},
    ]);
  });

  test('a depth past the tree returns an equal copy', () => {
    expect(pruneTree(tree(), 9)).toEqual(tree());
  });

  test('never mutates its input', () => {
    const input = tree();
    pruneTree(input, 1);
    expect(input).toEqual(tree());
  });
});
