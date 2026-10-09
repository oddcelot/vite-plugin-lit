import {describe, expect, test, vi} from 'vite-plus/test';
import {withDefineSources} from '../../lib/devframe/define-sources.js';
import {createNullSource} from '../../lib/devframe/source.js';
import type {TimelineSink, TimelineSource} from '../../lib/devframe/source.js';
import type {
  ElementSource,
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
  resolve: (f: unknown) => Promise<ElementSource | undefined>
) => {
  let sink: TimelineSink | undefined;
  const inner: TimelineSource = {
    ...createNullSource(),
    attach(s) {
      sink = s;
      return () => {};
    },
  };
  const got: InspectorMessage[] = [];
  const wrapped = withDefineSources(inner, resolve, 50);
  wrapped.attach({
    pushEvents() {},
    addLayer() {},
    hmrIncompatible() {},
    hmrPatched() {},
    runtimeReady() {},
    inspectorMessage: (m) => got.push(m),
  });
  return {push: (m: InspectorMessage) => sink!.inspectorMessage(m), got};
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
