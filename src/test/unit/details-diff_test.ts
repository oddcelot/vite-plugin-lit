import {expect, test} from 'vite-plus/test';
import {changedRows} from '../../panel/details-diff.js';
import type {InspectorDetails, InspectorProp} from '../../types/inspector.js';

const prop = (name: string, value: string, state = false): InspectorProp => ({
  name,
  value,
  type: 'number',
  attribute: state ? false : name,
  reflects: false,
  state,
});

const details = (over: Partial<InspectorDetails> = {}): InspectorDetails => ({
  id: 1,
  tagName: 'x-a',
  attributes: [{name: 'role', value: 'button'}],
  properties: [prop('count', '0'), prop('open', 'false', true)],
  flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
  extras: [
    {
      kind: 'task',
      name: 'load',
      value: 'undefined',
      type: 'Task',
      status: 'pending',
    },
  ],
  ...over,
});

test('names the rows whose value changed', () => {
  const next = details({
    properties: [prop('count', '1'), prop('open', 'false', true)],
    attributes: [{name: 'role', value: 'switch'}],
  });
  expect([...changedRows(details(), next)]).toEqual(['p:count', 'a:role']);
});

test('a task that changes status alone counts as changed', () => {
  const next = details({
    extras: [
      {
        kind: 'task',
        name: 'load',
        value: 'undefined',
        type: 'Task',
        status: 'complete',
      },
    ],
  });
  expect([...changedRows(details(), next)]).toEqual(['e:load']);
});

test('a row that appears counts, one that leaves does not', () => {
  const next = details({attributes: [{name: 'hidden', value: ''}]});
  expect([...changedRows(details(), next)]).toEqual(['a:hidden']);
});

test('nothing changes on a first snapshot or another element', () => {
  expect(changedRows(null, details()).size).toBe(0);
  expect(changedRows(details(), details({id: 2, properties: []})).size).toBe(0);
});

test('an identical refresh changes nothing', () => {
  expect(changedRows(details(), details()).size).toBe(0);
});
