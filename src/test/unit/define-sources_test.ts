import {describe, expect, test, vi} from 'vite-plus/test';
import {withDefineSources} from '../../lib/devframe/define-sources.js';
import {createNullSource} from '../../lib/devframe/source.js';
import type {TimelineSink, TimelineSource} from '../../lib/devframe/source.js';
import type {TimelineEvent} from '../../types/timeline.js';
import type {
  ElementSource,
  InspectorCommand,
  InspectorDetails,
  InspectorMessage,
} from '../../types/inspector.js';

const frames = [{url: 'https://app.test/a.js', line: 5, column: 1}];
const resolved: ElementSource = {
  file: 'src/a.ts',
  line: 3,
  column: 1,
  url: 'https://app.test/src/a.ts',
};

const details = (id: number, extra: Partial<InspectorDetails> = {}) =>
  ({
    type: 'details',
    details: {
      id,
      tagName: 'x-a',
      attributes: [],
      properties: [],
      flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
      ...extra,
    },
  }) as InspectorMessage;

/** A source whose page messages the test pushes; and what reached the sink. */
const harness = (
  resolve: (f: unknown) => Promise<ElementSource | undefined>,
  timeoutMs = 50
) => {
  let sink: TimelineSink | undefined;
  const sent: InspectorCommand[] = [];
  const inner: TimelineSource = {
    ...createNullSource(),
    attach(s) {
      sink = s;
      return () => {};
    },
    sendInspector: (cmd) => void sent.push(cmd),
  };
  const got: InspectorMessage[] = [];
  const events: TimelineEvent[][] = [];
  const wrapped = withDefineSources(inner, resolve, timeoutMs);
  wrapped.attach({
    pushEvents: (batch) => void events.push(batch),
    addLayer() {},
    hmrIncompatible() {},
    hmrPatched() {},
    runtimeReady() {},
    inspectorMessage: (m) => got.push(m),
  });
  return {
    push: (m: InspectorMessage, pageId?: string) =>
      sink!.inspectorMessage(m, pageId),
    pushEvents: (batch: TimelineEvent[], pageId?: string) =>
      sink!.pushEvents(batch, pageId),
    ready: (pageId: string) => sink!.runtimeReady(pageId),
    got,
    events,
    sent,
  };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('withDefineSources', () => {
  test('fills source from the define frames', async () => {
    const resolve = vi.fn(async () => resolved);
    const {push, got} = harness(resolve);
    push(details(1, {defineFrames: frames}));
    await settle();
    expect(resolve).toHaveBeenCalledWith(frames);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({details: {id: 1, source: resolved}});
  });

  test('passes stamped details and other messages straight through', () => {
    const resolve = vi.fn(async () => resolved);
    const {push, got} = harness(resolve);
    push(
      details(1, {source: {file: 'src/x.ts', line: 1}, defineFrames: frames})
    );
    push({type: 'tree', roots: []});
    expect(got.map((m) => m.type)).toEqual(['details', 'tree']);
    expect(resolve).not.toHaveBeenCalled();
  });

  test('keeps message order behind a held one', async () => {
    let release: (s: ElementSource) => void = () => {};
    const {push, got} = harness(() => new Promise((r) => (release = r)));
    push(details(1, {defineFrames: frames}));
    push({type: 'gone', id: 1});
    await settle();
    expect(got).toEqual([]);
    release(resolved);
    await settle();
    expect(got.map((m) => m.type)).toEqual(['details', 'gone']);
    push({type: 'tree', roots: []});
    expect(got.map((m) => m.type)).toEqual(['details', 'gone', 'tree']);
  });

  test('a failing or slow resolver leaves the details as they came', async () => {
    const failing = harness(async () => {
      throw new Error('boom');
    });
    failing.push(details(1, {defineFrames: frames}));
    await settle();
    expect(failing.got[0]).toMatchObject({details: {id: 1}});
    expect((failing.got[0] as {details: InspectorDetails}).details.source).toBe(
      undefined
    );

    const slow = harness(() => new Promise(() => {}));
    slow.push(details(2, {defineFrames: frames}));
    await new Promise((r) => setTimeout(r, 80));
    expect(slow.got).toHaveLength(1);
  });
});

describe('withDefineSources, by define id', () => {
  const frames2 = [{url: 'https://app.test/b.js', line: 9, column: 2}];
  const resolved2: ElementSource = {file: 'src/b.ts', line: 7};
  /** Resolves each frame set by its url. */
  const byUrl = vi.fn(async (f: unknown) =>
    (f as typeof frames)[0]!.url.endsWith('a.js') ? resolved : resolved2
  );
  const ev = (time: number, defineId?: number, source?: ElementSource) =>
    ({
      layerId: 'lit-lifecycle',
      time,
      data: {},
      meta: {
        elementId: time,
        tagName: 'x-a',
        ...(defineId === undefined ? {} : {defineId}),
        ...(source === undefined ? {} : {source}),
      },
    }) as TimelineEvent;
  const reply = (frameMap: Record<number, typeof frames>) =>
    ({type: 'define-frames', frames: frameMap}) as InspectorMessage;

  test('holds events until the frames reply, then sets meta.source', async () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 0), ev(2)], 'p1');
    expect(h.events).toEqual([]);
    expect(h.sent).toEqual([{type: 'define-frames', ids: [0]}]);
    h.push(reply({0: frames}), 'p1');
    await settle();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]![0]!.meta).toMatchObject({
      defineId: 0,
      source: resolved,
    });
    expect(h.events[0]![1]!.meta).not.toHaveProperty('source');
  });

  test('asks for several unknown ids in one command, and never forwards the reply', async () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 0), ev(2, 1), ev(3, 0)], 'p1');
    expect(h.sent).toEqual([{type: 'define-frames', ids: [0, 1]}]);
    h.push(reply({0: frames, 1: frames2}), 'p1');
    await settle();
    expect(h.events[0]!.map((e) => e.meta?.source)).toEqual([
      resolved,
      resolved2,
      resolved,
    ]);
    expect(h.got).toEqual([]);
  });

  test('fills a cached id on the spot, without a second command', async () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 0)], 'p1');
    h.push(reply({0: frames}), 'p1');
    await settle();
    h.pushEvents([ev(2, 0)], 'p1');
    expect(h.events).toHaveLength(2);
    expect(h.events[1]![0]!.meta?.source).toEqual(resolved);
    expect(h.sent).toHaveLength(1);
  });

  test('keys the cache by page', async () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 0)], 'p1');
    h.push(reply({0: frames}), 'p1');
    await settle();
    h.pushEvents([ev(2, 0)], 'p2');
    expect(h.sent).toHaveLength(2);
    expect(h.events).toHaveLength(1);
  });

  test('keeps event order behind a held batch', async () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 0)], 'p1');
    h.pushEvents([ev(2)], 'p1');
    expect(h.events).toEqual([]);
    h.push(reply({0: frames}), 'p1');
    await settle();
    expect(h.events.map((b) => b[0]!.time)).toEqual([1, 2]);
  });

  test('passes events with a source, or no define id, straight through', () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 0, resolved), ev(2)], 'p1');
    expect(h.events).toHaveLength(1);
    expect(h.sent).toEqual([]);
  });

  test('an unanswered ask releases the events unresolved and is not retried', async () => {
    const h = harness(byUrl, 20);
    h.pushEvents([ev(1, 0)], 'p1');
    await new Promise((r) => setTimeout(r, 60));
    expect(h.events).toHaveLength(1);
    expect(h.events[0]![0]!.meta).not.toHaveProperty('source');
    h.pushEvents([ev(2, 0)], 'p1');
    expect(h.events).toHaveLength(2);
    expect(h.sent).toHaveLength(1);
  });

  test('an id the page does not know stays unresolved', async () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 5)], 'p1');
    h.push(reply({}), 'p1');
    await settle();
    expect(h.events[0]![0]!.meta).not.toHaveProperty('source');
    expect(byUrl).not.toHaveBeenCalled();
  });

  test('fills tree nodes recursively, in message order', async () => {
    const h = harness(byUrl);
    h.push(
      {
        type: 'tree',
        roots: [
          {
            id: 1,
            tagName: 'x-a',
            defineId: 0,
            children: [
              {id: 2, tagName: 'x-b', defineId: 1, children: []},
              {
                id: 3,
                tagName: 'x-c',
                source: {file: 's.ts', line: 1},
                children: [],
              },
            ],
          },
        ],
      },
      'p1'
    );
    h.push({type: 'gone', id: 9}, 'p1');
    expect(h.got).toEqual([]);
    expect(h.sent).toEqual([{type: 'define-frames', ids: [0, 1]}]);
    h.push(reply({0: frames, 1: frames2}), 'p1');
    await settle();
    expect(h.got.map((m) => m.type)).toEqual(['tree', 'gone']);
    const tree = h.got[0] as {
      roots: Array<{
        source?: ElementSource;
        children: Array<{source?: ElementSource}>;
      }>;
    };
    expect(tree.roots[0]!.source).toEqual(resolved);
    expect(tree.roots[0]!.children.map((c) => c.source)).toEqual([
      resolved2,
      {file: 's.ts', line: 1},
    ]);
    // Cached now: the next tree goes through at once.
    h.push(
      {
        type: 'tree',
        roots: [{id: 1, tagName: 'x-a', defineId: 0, children: []}],
      },
      'p1'
    );
    expect(h.got).toHaveLength(3);
    expect(
      (h.got[2] as {roots: Array<{source?: ElementSource}>}).roots[0]!.source
    ).toEqual(resolved);
  });

  test('a new page runtime drops the old page entries', async () => {
    const h = harness(byUrl);
    h.pushEvents([ev(1, 0)], 'p1');
    h.push(reply({0: frames}), 'p1');
    await settle();
    h.ready('p2');
    h.pushEvents([ev(2, 0)], 'p1');
    expect(h.sent).toHaveLength(2);
  });
});
