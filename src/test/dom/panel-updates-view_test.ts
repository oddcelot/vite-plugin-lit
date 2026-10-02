import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';
import {resetStore, setEvents} from './fakes/timeline-store.js';

vi.mock(
  '../../panel/timeline-store.js',
  () => import('./fakes/timeline-store.js')
);

beforeAll(async () => {
  await import('../../panel/updates-view.js');
});

/** One `performUpdate` tick of element `id`. */
const tick = (
  id: number,
  tagName: string,
  n: number,
  time: number
): TimelineEvent[] =>
  (['start', 'end'] as const).map((edge, i) => ({
    layerId: 'lit-lifecycle',
    time: time + i * 2,
    groupId: `${id}:${n}`,
    title: `performUpdate:${edge}`,
    data:
      edge === 'start'
        ? {phase: 'performUpdate', changed: ['count']}
        : {phase: 'performUpdate'},
    meta: {elementId: id, tagName},
  }));

const events = [
  ...tick(1, 'x-counter', 1, 0),
  ...tick(1, 'x-counter', 2, 10),
  ...tick(2, 'x-clock', 1, 20),
];

const mount = async () => {
  const el = document.createElement('updates-view');
  document.body.append(el);
  await el.updateComplete;
  const root = el.shadowRoot!;
  const rows = () =>
    [...root.querySelectorAll<HTMLElement>('.components .row')].map((row) => ({
      row,
      tag: row.querySelector('.tag')!.textContent!.trim(),
      selected: row.classList.contains('selected'),
    }));
  const cycles = () => root.querySelectorAll('.cycles .row');
  const settle = () => el.updateComplete;
  return {el, root, rows, cycles, settle};
};

afterEach(() => {
  document.body.replaceChildren();
  resetStore();
});

test('says what to do while nothing has been recorded', async () => {
  const {root} = await mount();
  expect(root.querySelector('.empty')?.textContent).toContain(
    'No component updates recorded.'
  );
});

test('lists one row per component, with its instance count', async () => {
  const {rows, settle} = await mount();
  setEvents(events);
  await settle();
  expect(
    rows()
      .map((r) => r.tag)
      .sort()
  ).toEqual(['<x-clock>', '<x-counter>']);
});

test('a row click selects it, lists its updates and tells the shell', async () => {
  const {el, rows, cycles, settle} = await mount();
  setEvents(events);
  await settle();
  const changes = vi.fn();
  el.addEventListener('selection-change', changes);
  rows()
    .find((r) => r.tag === '<x-counter>')!
    .row.click();
  await settle();
  expect(rows().find((r) => r.selected)?.tag).toBe('<x-counter>');
  expect(cycles()).toHaveLength(2);
  expect(changes).toHaveBeenCalledOnce();
  expect(el.selectedId).toBe(1);
});

test('a deep link that arrives before its events waits for them', async () => {
  const {el, rows, settle} = await mount();
  el.selectById(2);
  await settle();
  expect(el.selectedId).toBeNull();
  setEvents(events);
  await settle();
  expect(rows().find((r) => r.selected)?.tag).toBe('<x-clock>');
  expect(el.selectedId).toBe(2);
});

test('drops the selection when its component leaves the buffer', async () => {
  const {el, rows, settle} = await mount();
  setEvents(events);
  await settle();
  el.selectById(2);
  await settle();
  setEvents(tick(1, 'x-counter', 3, 30));
  await settle();
  expect(rows().some((r) => r.selected)).toBe(false);
  expect(el.selectedId).toBeNull();
});

test('an instance link asks the shell to open it in Components', async () => {
  const {el, root, settle} = await mount();
  setEvents(events);
  await settle();
  el.selectById(1);
  await settle();
  const inspected: number[] = [];
  document.body.addEventListener('inspect-element', (e) =>
    inspected.push((e as CustomEvent<{id: number}>).detail.id)
  );
  root.querySelector<HTMLElement>('.cycles .row .link')!.click();
  expect(inspected).toEqual([1]);
});

test('flags a component and an update in which a phase threw', async () => {
  const {el, root, settle} = await mount();
  const error = {name: 'TypeError', message: 'render exploded'};
  // As the runtime emits it: update and performUpdate both end in error.
  const failing: TimelineEvent[] = [
    ...tick(1, 'x-counter', 1, 0),
    ...(['start', 'end'] as const).flatMap((edge, i) =>
      ['performUpdate', 'update'].map((name) => ({
        layerId: 'lit-lifecycle',
        time: 10 + i * 2,
        groupId: '1:2',
        title: `${name}:${edge}`,
        data:
          edge === 'end'
            ? {phase: name, error}
            : {phase: name, changed: ['count']},
        ...(edge === 'end' ? {logType: 'error' as const} : {}),
        meta: {elementId: 1, tagName: 'x-counter'},
      }))
    ),
  ];
  setEvents(failing);
  await settle();
  expect(root.querySelector('.components .errors')?.textContent).toMatch(
    /\s1\s*$/
  );
  el.selectById(1);
  await settle();
  expect(root.querySelector('.cycles .row .threw')?.textContent).toMatch(
    /threw in update:\s+TypeError/
  );
});

test('shows old and new values and flags a new reference with equal content', async () => {
  const {root, rows, settle} = await mount();
  const detailed = tick(3, 'x-list', 1, 0);
  detailed[0]!.data = {
    phase: 'performUpdate',
    changed: ['items'],
    changedDetail: [
      {
        key: 'items',
        prev: '[1, 2]',
        next: '[1, 2]',
        sameRef: false,
        equal: true,
      },
    ],
  };
  setEvents([...detailed, ...tick(1, 'x-counter', 1, 10)]);
  await settle();
  const list = rows().find((r) => r.tag === '<x-list>')!;
  expect(list.row.querySelector('.redundant')?.getAttribute('title')).toContain(
    'items ×1'
  );
  expect(
    rows()
      .find((r) => r.tag === '<x-counter>')!
      .row.querySelector('.redundant')
  ).toBeNull();

  list.row.click();
  await settle();
  const change = root.querySelector('.cycles .change')!;
  const values = [...change.querySelectorAll('.value')];
  expect(values.map((v) => v.textContent)).toEqual(['[1, 2]', '[1, 2]']);
  const arrow = change.querySelector('wa-icon[name="arrow-right"]')!;
  expect(arrow).not.toBeNull();
  expect(arrow.previousElementSibling).toBe(values[0]);
  expect(arrow.nextElementSibling).toBe(values[1]);
  expect(change.textContent!.replace(/\s+/g, ' ')).toContain(
    'new reference, same value'
  );
});

test('renders no value block for cycles without detail', async () => {
  const {root, rows, settle} = await mount();
  setEvents(events);
  await settle();
  rows()
    .find((r) => r.tag === '<x-counter>')!
    .row.click();
  await settle();
  expect(root.querySelector('.changes')).toBeNull();
});
