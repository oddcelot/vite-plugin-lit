import {afterEach, beforeEach, describe, expect, test} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';
import {
  installRenderLayer,
  uninstallRenderLayer,
} from '../../lib/runtime/timeline/render.js';

let events: TimelineEvent[];
let recording: boolean;
let renderOn: boolean;
let verboseOn: boolean;

const dispatch = (detail: Record<string, unknown> | undefined) =>
  window.dispatchEvent(new CustomEvent('lit-debug', {detail}));

beforeEach(() => {
  events = [];
  recording = true;
  renderOn = true;
  verboseOn = true;
  installRenderLayer(
    (e) => events.push(e),
    () => recording,
    () => renderOn,
    () => verboseOn
  );
});

afterEach(() => uninstallRenderLayer());

describe('lit-render layer', () => {
  test('begin/end render share the group id and carry no host meta without a host', () => {
    dispatch({kind: 'begin render', id: 7});
    dispatch({kind: 'end render', id: 7});
    expect(events).toEqual([
      expect.objectContaining({
        layerId: 'lit-render',
        groupId: 7,
        title: 'render:start',
        subtitle: undefined,
        data: {kind: 'begin render', id: 7},
        meta: undefined,
      }),
      expect.objectContaining({
        layerId: 'lit-render',
        groupId: 7,
        title: 'render:end',
        data: {kind: 'end render', id: 7},
      }),
    ]);
  });

  test('template prep is an ungrouped lit-render marker', () => {
    dispatch({kind: 'template prep', id: 3});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      layerId: 'lit-render',
      title: 'template prep',
      data: {kind: 'template prep', id: 3},
    });
    expect('groupId' in events[0]!).toBe(false);
  });

  test('host-bearing renders carry the element tag', () => {
    const host = document.createElement('my-host');
    dispatch({kind: 'begin render', id: 1, options: {host}});
    expect(events[0]!.subtitle).toBe('my-host');
    expect(events[0]!.meta).toBeDefined();
  });

  test('ignores unknown kinds, missing kind and missing detail', () => {
    dispatch({kind: 'some future kind'});
    dispatch({kind: 'constructor'});
    dispatch({});
    dispatch(undefined);
    expect(events).toEqual([]);
  });

  test('honours the recording flag and each layer toggle', () => {
    recording = false;
    dispatch({kind: 'begin render', id: 1});
    recording = true;
    renderOn = false;
    dispatch({kind: 'begin render', id: 1});
    dispatch({kind: 'commit text', value: 'a'});
    expect(events.map((e) => e.layerId)).toEqual(['lit-render-verbose']);
    events.length = 0;
    renderOn = true;
    verboseOn = false;
    dispatch({kind: 'begin render', id: 1});
    dispatch({kind: 'commit text', value: 'a'});
    expect(events.map((e) => e.layerId)).toEqual(['lit-render']);
    events.length = 0;
    renderOn = false;
    dispatch({kind: 'begin render', id: 1});
    expect(events).toEqual([]);
  });
});

describe('lit-render-verbose layer', () => {
  const verbose = (detail: Record<string, unknown>) => {
    dispatch(detail);
    return events.at(-1)!;
  };

  test('template kinds summarize their values', () => {
    for (const kind of [
      'template updating',
      'template instantiated',
      'template instantiated and updated',
    ]) {
      expect(verbose({kind, values: [1, 'a', null]})).toMatchObject({
        layerId: 'lit-render-verbose',
        title: kind,
        data: {kind, values: ['number:1', 'string:"a"', 'null']},
      });
    }
    expect(
      verbose({kind: 'template updating'}).data as Record<string, unknown>
    ).toEqual({kind: 'template updating', values: undefined});
  });

  test('set part reads the host off the part and carries the value index', () => {
    const host = document.createElement('part-host');
    const e = verbose({
      kind: 'set part',
      valueIndex: 2,
      value: true,
      part: {options: {host}},
    });
    expect(e.subtitle).toBe('part-host');
    expect(e.data).toEqual({
      kind: 'set part',
      valueIndex: 2,
      value: 'boolean:true',
    });
  });

  test('commit nothing to child carries only the kind', () => {
    expect(verbose({kind: 'commit nothing to child'}).data).toEqual({
      kind: 'commit nothing to child',
    });
  });

  test('value commits carry the described value', () => {
    for (const kind of [
      'commit text',
      'commit node',
      'commit to element binding',
    ]) {
      expect(verbose({kind, value: 5}).data).toEqual({
        kind,
        value: 'number:5',
      });
    }
  });

  test('attribute-style commits also carry the name', () => {
    for (const kind of [
      'commit attribute',
      'commit property',
      'commit boolean attribute',
    ]) {
      expect(verbose({kind, name: 'foo', value: 'x'}).data).toEqual({
        kind,
        name: 'foo',
        value: 'string:"x"',
      });
    }
  });

  test('event listener commits carry the add/remove flags', () => {
    expect(
      verbose({
        kind: 'commit event listener',
        name: 'click',
        addListener: true,
        removeListener: false,
      }).data
    ).toEqual({
      kind: 'commit event listener',
      name: 'click',
      addListener: true,
      removeListener: false,
    });
  });

  test('describes every value shape', () => {
    function named() {}
    const long = 'x'.repeat(50);
    const cases: [unknown, string][] = [
      [null, 'null'],
      [undefined, 'undefined'],
      ['hi', 'string:"hi"'],
      [long, `string:"${'x'.repeat(40)}…"`],
      [3, 'number:3'],
      [false, 'boolean:false'],
      [named, 'function:named'],
      [() => {}, 'function:anonymous'],
      [Symbol('nothing'), 'symbol:nothing'],
      [[1, 2], 'array(2)'],
      [{_$litType$: 1}, 'template'],
      [document.createElement('div'), 'node:<div>'],
      [document.createTextNode('t'), 'node:#3'],
      [new Map(), 'object:Map'],
      [Object.create(null), 'object:Object'],
      [10n, 'object:BigInt'],
    ];
    for (const [value, expected] of cases) {
      expect(verbose({kind: 'commit text', value}).data).toEqual({
        kind: 'commit text',
        value: expected,
      });
    }
  });
});
