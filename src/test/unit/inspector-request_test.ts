import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {createInspectorRequester} from '../../lib/devframe/inspector-request.js';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';

const node = (id: number): InspectorTreeNode => ({
  id,
  tagName: `x-${id}`,
  children: [],
});

const detailsOf = (id: number): InspectorDetails => ({
  id,
  tagName: `x-${id}`,
  attributes: [],
  properties: [],
  flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
});

const setup = () => {
  const sent: InspectorCommand[] = [];
  const requester = createInspectorRequester({
    sendInspector: (cmd) => sent.push(cmd),
  });
  return {sent, requester};
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createInspectorRequester', () => {
  test('tree() sends a tree command and resolves with the reply', async () => {
    const {sent, requester} = setup();
    const pending = requester.tree(1000);
    expect(sent).toEqual([{type: 'tree'}]);
    requester.resolve({type: 'tree', roots: [node(1)]});
    expect(await pending).toEqual([node(1)]);
  });

  test('concurrent tree() calls all resolve from one reply', async () => {
    const {sent, requester} = setup();
    const a = requester.tree(1000);
    const b = requester.tree(1000);
    expect(sent).toHaveLength(2);
    requester.resolve({type: 'tree', roots: [node(1)]});
    expect(await a).toEqual([node(1)]);
    expect(await b).toEqual([node(1)]);
  });

  test('details() resolves for its own id and leaves other ids waiting', async () => {
    vi.useFakeTimers();
    const {sent, requester} = setup();
    const seven = requester.details(7, 1000);
    let eightSettled = false;
    void requester.details(8, 1000).then(() => (eightSettled = true));
    expect(sent).toEqual([
      {type: 'details', id: 7},
      {type: 'details', id: 8},
    ]);
    requester.resolve({type: 'details', details: detailsOf(7)});
    expect(await seven).toEqual(detailsOf(7));
    expect(eightSettled).toBe(false);
  });

  test('details() resolves null when the page reports the element gone', async () => {
    const {requester} = setup();
    const pending = requester.details(7, 1000);
    requester.resolve({type: 'gone', id: 7});
    expect(await pending).toBeNull();
  });

  test('resolves undefined on timeout and tolerates a late reply', async () => {
    vi.useFakeTimers();
    const {requester} = setup();
    const pending = requester.tree(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBeUndefined();
    expect(() =>
      requester.resolve({type: 'tree', roots: [node(1)]})
    ).not.toThrow();
  });

  test('a throwing sendInspector rejects without leaking a timer or waiter', async () => {
    vi.useFakeTimers();
    const requester = createInspectorRequester({
      sendInspector() {
        throw new Error('channel closed');
      },
    });
    await expect(requester.tree(1000)).rejects.toThrow('channel closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
