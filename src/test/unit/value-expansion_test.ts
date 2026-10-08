import {expect, test} from 'vite-plus/test';
import {ValueExpansion} from '../../panel/value-expansion.js';
import type {
  InspectorCommand,
  ValueChild,
  ValuePath,
} from '../../types/inspector.js';

const setup = () => {
  const sent: InspectorCommand[] = [];
  let changes = 0;
  const x = new ValueExpansion(
    (c) => sent.push(c),
    () => changes++
  );
  x.follow(7);
  return {x, sent, changes: () => changes};
};

const path = (name: string, ...keys: Array<string | number>): ValuePath => ({
  section: 'prop',
  name,
  keys,
});

const kid = (label: string): ValueChild => ({
  label,
  key: label,
  value: '1',
  type: 'number',
  expandable: false,
});

test('opening a value asks the page for its children', () => {
  const {x, sent} = setup();
  x.toggle(path('config'));
  expect(x.isOpen(path('config'))).toBe(true);
  expect(x.level(path('config'))).toEqual({status: 'loading'});
  expect(sent).toEqual([{type: 'expand', id: 7, path: path('config')}]);
});

test('an answer fills the level; a stale one is dropped', () => {
  const {x} = setup();
  x.toggle(path('config'));
  x.receive({type: 'expanded', id: 8, path: path('config'), children: []});
  expect(x.level(path('config'))).toEqual({status: 'loading'});
  x.receive({
    type: 'expanded',
    id: 7,
    path: path('config'),
    children: [kid('a')],
    more: 3,
  });
  expect(x.level(path('config'))).toEqual({
    status: 'ready',
    children: [kid('a')],
    more: 3,
  });
});

test('a path that stopped resolving shows as gone', () => {
  const {x} = setup();
  x.toggle(path('config'));
  x.receive({type: 'expanded', id: 7, path: path('config'), children: null});
  expect(x.level(path('config'))).toEqual({status: 'gone'});
});

test('closing a value closes everything under it', () => {
  const {x} = setup();
  x.toggle(path('config'));
  x.toggle(path('config', 'theme'));
  x.toggle(path('other'));
  x.toggle(path('config'));
  expect(x.isOpen(path('config', 'theme'))).toBe(false);
  expect(x.isOpen(path('other'))).toBe(true);
});

test('a refresh re-asks for open levels under that row, keeping old children', () => {
  const {x, sent} = setup();
  x.toggle(path('config'));
  x.receive({
    type: 'expanded',
    id: 7,
    path: path('config'),
    children: [kid('a')],
  });
  x.toggle(path('config', 'a'));
  x.toggle(path('other'));
  sent.length = 0;
  x.refresh('prop', 'config');
  expect(sent.map((c) => (c.type === 'expand' ? c.path.keys : null))).toEqual([
    [],
    ['a'],
  ]);
  expect(x.level(path('config'))).toEqual({
    status: 'loading',
    children: [kid('a')],
    more: 0,
  });
});

test('another element starts with nothing open', () => {
  const {x} = setup();
  x.toggle(path('config'));
  x.follow(9);
  expect(x.isOpen(path('config'))).toBe(false);
  x.follow(9);
  x.toggle(path('config'));
  expect(x.isOpen(path('config'))).toBe(true);
});

test('nothing opens without an element', () => {
  const {x, sent} = setup();
  x.follow(null);
  x.toggle(path('config'));
  expect(x.isOpen(path('config'))).toBe(false);
  expect(sent).toEqual([]);
});
