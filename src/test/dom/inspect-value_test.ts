import {expect, test} from 'vite-plus/test';
import {expandPath} from '../../lib/runtime/inspector/collect.js';
import {collectExtras} from '../../lib/runtime/inspector/extras.js';
import {
  childrenOf,
  isExpandable,
  MAX_CHILDREN,
  stepInto,
} from '../../lib/runtime/inspector/inspect-value.js';

let counter = 0;

const host = (
  declared: string[] = []
): HTMLElement & Record<string, unknown> => {
  const tag = `x-expand-${counter++}`;
  class El extends HTMLElement {
    static elementProperties = new Map(declared.map((k) => [k, {}]));
    hasUpdated = false;
    isUpdatePending = false;
    requestUpdate() {}
  }
  customElements.define(tag, El);
  return document.createElement(tag) as HTMLElement & Record<string, unknown>;
};

const labels = (value: unknown) =>
  childrenOf(value).children.map(
    (c) =>
      `${c.label}${c.entry ? ' =>' : ':'} ${c.value}${c.expandable ? ' +' : ''}`
  );

test('only containers with something in them expand', () => {
  expect(isExpandable({a: 1})).toBe(true);
  expect(isExpandable([0])).toBe(true);
  expect(isExpandable(new Map([[1, 2]]))).toBe(true);
  expect(isExpandable(new Uint8Array(2))).toBe(true);
  for (const value of [
    {},
    [],
    new Set(),
    'text',
    42,
    null,
    () => 1,
    new Date(0),
    /x/,
    document.createElement('div'),
    new DataView(new ArrayBuffer(4)),
  ]) {
    expect(isExpandable(value)).toBe(false);
  }
});

test('lists object keys, array indices and collection entries', () => {
  expect(labels({id: 1, user: {name: 'Ada'}})).toEqual([
    'id: 1',
    'user: {name: "Ada"} +',
  ]);
  expect(labels(['a', [1]])).toEqual(['0: "a"', '1: [1] +']);
  expect(labels(new Map<unknown, unknown>([['k', {x: 1}]]))).toEqual([
    '"k" => {x: 1} +',
  ]);
  expect(labels(new Set(['s']))).toEqual(['0: "s"']);
});

test('caps a level and counts the rest', () => {
  const {children, more} = childrenOf(
    Array.from({length: MAX_CHILDREN + 5}, (_, i) => i)
  );
  expect(children).toHaveLength(MAX_CHILDREN);
  expect(more).toBe(5);
});

test('a throwing getter lists as a placeholder, not a failure', () => {
  const value = {
    get bad(): never {
      throw new Error('no');
    },
    ok: 1,
  };
  expect(labels(value)).toEqual(['bad: [getter threw]', 'ok: 1']);
});

test('steps into keys and positions as childrenOf numbered them', () => {
  const map = new Map([['a', {deep: true}]]);
  expect(stepInto(map, 0)).toEqual({value: {deep: true}});
  expect(stepInto(new Set(['x', 'y']), 1)).toEqual({value: 'y'});
  expect(stepInto([1, 2], 1)).toEqual({value: 2});
  expect(stepInto({a: 1}, 'a')).toEqual({value: 1});
});

test('a step that no longer fits the value does not resolve', () => {
  expect(stepInto([1], 3)).toBeUndefined();
  expect(stepInto([1], '0')).toBeUndefined();
  expect(stepInto({a: 1}, 0)).toBeUndefined();
  expect(stepInto({a: 1}, 'toString')).toBeUndefined();
  expect(stepInto(new Map(), 0)).toBeUndefined();
  expect(stepInto('text', 'length')).toBeUndefined();
});

test('expands a reactive property down a path', () => {
  const el = host(['config']);
  el['config'] = {theme: {mode: 'dark', accents: ['red']}};
  expect(
    expandPath(el, {
      section: 'prop',
      name: 'config',
      keys: ['theme'],
    })?.children.map((c) => c.label)
  ).toEqual(['mode', 'accents']);
  expect(
    expandPath(el, {
      section: 'prop',
      name: 'config',
      keys: ['theme', 'accents'],
    })?.children.map((c) => c.value)
  ).toEqual(['"red"']);
});

test('only declared properties are reachable', () => {
  const el = host(['config']);
  el['secret'] = {token: 'x'};
  expect(
    expandPath(el, {section: 'prop', name: 'secret', keys: []})
  ).toBeNull();
});

test('a path that stops resolving answers null', () => {
  const el = host(['config']);
  el['config'] = {theme: 'plain'};
  expect(
    expandPath(el, {section: 'prop', name: 'config', keys: ['theme', 'mode']})
  ).toBeNull();
});

test('expands a plain field listed among the extras', () => {
  const el = host();
  el['cache'] = new Map([['a', 1]]);
  expect(collectExtras(el)).toEqual([
    expect.objectContaining({name: 'cache', expandable: true}),
  ]);
  expect(
    expandPath(el, {section: 'extra', name: 'cache', keys: []})?.children
  ).toEqual([
    {
      label: '"a"',
      key: 0,
      entry: true,
      value: '1',
      type: 'number',
      expandable: false,
    },
  ]);
});
