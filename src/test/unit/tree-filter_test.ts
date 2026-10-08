import {expect, test} from 'vite-plus/test';
import {filterTree} from '../../panel/tree-filter.js';
import type {InspectorTreeNode} from '../../types/inspector.js';

const node = (
  id: number,
  tagName: string,
  children: InspectorTreeNode[] = [],
  componentName?: string
): InspectorTreeNode => ({
  id,
  tagName,
  children,
  ...(componentName === undefined ? {} : {componentName}),
});

const tree = [
  node(1, 'x-app', [
    node(2, 'x-header', [node(3, 'x-button')]),
    node(4, 'x-list', [node(5, 'x-item'), node(6, 'x-item')]),
  ]),
  node(7, 'x-footer', [], 'SiteFooter'),
];

const ids = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b);

test('keeps each match and its ancestors, nothing else', () => {
  const {keep, matched} = filterTree(tree, 'item');
  expect(ids(matched)).toEqual([5, 6]);
  expect(ids(keep)).toEqual([1, 4, 5, 6]);
});

test('ignores case and surrounding space', () => {
  expect(ids(filterTree(tree, '  BUTTON ').matched)).toEqual([3]);
});

test('matches the component class name too', () => {
  const {keep, matched} = filterTree(tree, 'sitefoot');
  expect(ids(matched)).toEqual([7]);
  expect(ids(keep)).toEqual([7]);
});

test('an ancestor that matches is both kept and matched', () => {
  const {keep, matched} = filterTree(tree, 'x-');
  expect(ids(matched)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(ids(keep)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test('an empty query keeps nothing', () => {
  expect(filterTree(tree, '   ')).toEqual({
    keep: new Set(),
    matched: new Set(),
  });
});
