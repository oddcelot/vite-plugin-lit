import {afterEach, beforeAll, describe, expect, test, vi} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';
import {resetStore, setEvents} from './fakes/timeline-store.js';
import {answers, calls, meta, resetClient} from './fakes/client.js';
import {resetHostInfo} from '../../panel/host.js';
import {useSourceOpener} from '../../panel/source-opener.js';

vi.mock(
  '../../panel/timeline-store.js',
  () => import('./fakes/timeline-store.js')
);
// Source links ask the host whether they can open; see `fakes/client.ts`.
vi.mock('../../panel/client.js', () => import('./fakes/client.js'));

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
  resetClient();
  resetHostInfo();
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
  el.location.subscribe(changes);
  rows()
    .find((r) => r.tag === '<x-counter>')!
    .row.click();
  await settle();
  expect(rows().find((r) => r.selected)?.tag).toBe('<x-counter>');
  expect(cycles()).toHaveLength(2);
  expect(changes).toHaveBeenCalledOnce();
  expect(el.location.selected('updates')).toBe(1);
});

test('a deep link that arrives before its events waits for them', async () => {
  const {el, rows, settle} = await mount();
  el.location.apply({tab: 'updates', componentId: 2});
  await settle();
  expect(el.location.selected('updates')).toBeNull();
  setEvents(events);
  await settle();
  expect(rows().find((r) => r.selected)?.tag).toBe('<x-clock>');
  expect(el.location.selected('updates')).toBe(2);
});

test('drops the selection when its component leaves the buffer', async () => {
  const {el, rows, settle} = await mount();
  setEvents(events);
  await settle();
  el.location.apply({tab: 'updates', componentId: 2});
  await settle();
  setEvents(tick(1, 'x-counter', 3, 30));
  await settle();
  expect(rows().some((r) => r.selected)).toBe(false);
  expect(el.location.selected('updates')).toBeNull();
});

test('an instance link asks the shell to open it in Components', async () => {
  const {el, root, settle} = await mount();
  setEvents(events);
  await settle();
  el.location.apply({tab: 'updates', componentId: 1});
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
  el.location.apply({tab: 'updates', componentId: 1});
  await settle();
  expect(root.querySelector('.cycles .row .threw')?.textContent).toMatch(
    /threw in update:\s+TypeError/
  );
});

test.each([
  [
    'rejected',
    {title: 'updated:rejected', data: {phase: 'updated', async: true}},
    /rejected in updated:\s+TypeError/,
  ],
  [
    'task',
    {
      title: 'task:error',
      data: {phase: 'task', task: 'userTask', async: true},
    },
    /task userTask failed:\s+TypeError/,
  ],
])('labels an async %s error', async (_label, event, badge) => {
  const {el, root, settle} = await mount();
  const error = {name: 'TypeError', message: 'nope'};
  setEvents([
    ...tick(1, 'x-counter', 1, 0),
    {
      layerId: 'lit-lifecycle',
      time: 5,
      groupId: '1:1',
      title: event.title,
      data: {...event.data, error},
      logType: 'error',
      meta: {elementId: 1, tagName: 'x-counter'},
    },
  ]);
  await settle();
  el.location.apply({tab: 'updates', componentId: 1});
  await settle();
  const threw = root.querySelector('.cycles .row .threw');
  expect(threw?.textContent).toMatch(badge);
  expect(threw?.getAttribute('title')).toBe('nope');
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
  expect(
    list.row.querySelector('.redundant')?.getAttribute('data-tip')
  ).toContain('items ×1');
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

describe('rendered at', () => {
  const site = {file: 'src/app.ts', line: 30, column: 5};
  const stamped = (id: number, tagName: string, n: number, time: number) =>
    tick(id, tagName, n, time).map((e) => ({
      ...e,
      meta: {...e.meta, callSite: site},
    }));

  const select = async (data: TimelineEvent[], tag: string) => {
    const view = await mount();
    setEvents(data);
    await view.settle();
    view
      .rows()
      .find((r) => r.tag.startsWith(tag))!
      .row.click();
    await view.settle();
    // `canOpenInEditor()` settles a microtask later.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await view.settle();
    return view;
  };

  test('links the call site of a single instance and opens it at its column', async () => {
    answers.set('open-source', {opened: true});
    const {root, settle} = await select(
      [...stamped(1, 'x-counter', 1, 0), ...tick(2, 'x-clock', 1, 20)],
      '<x-counter>'
    );
    const link = root.querySelector<HTMLElement>('wa-button.call-site')!;
    expect(link.textContent).toContain('Rendered at src/app.ts:30');
    link.click();
    await settle();
    expect(calls.find((c) => c.name === 'open-source')?.args).toEqual([
      {file: 'src/app.ts', line: 30, column: 5},
    ]);
  });

  test('a sourcemapped component source opens in the host viewer, with no editor', async () => {
    meta.capabilities.openInEditor = false;
    const seen: unknown[] = [];
    useSourceOpener((loc) => void seen.push(loc));
    try {
      const source = {
        file: 'src/counter.ts',
        line: 3,
        url: 'https://app.test/src/counter.ts',
      };
      const {root, settle} = await select(
        tick(1, 'x-counter', 1, 0).map((e) => ({
          ...e,
          meta: {...e.meta, source},
        })),
        '<x-counter>'
      );
      const link = root.querySelector<HTMLElement>('wa-button.link')!;
      expect(link.dataset['tip']).toBe('Open in Sources');
      link.click();
      await settle();
      expect(seen).toEqual([source]);
      expect(calls.some((c) => c.name === 'open-source')).toBe(false);
    } finally {
      useSourceOpener(undefined);
    }
  });

  test('is plain text where the host has no editor', async () => {
    meta.capabilities.openInEditor = false;
    const {root} = await select(stamped(1, 'x-counter', 1, 0), '<x-counter>');
    expect(root.querySelector('wa-button.call-site')).toBeNull();
    expect(root.querySelector('.call-site')!.textContent).toBe(
      'Rendered at src/app.ts:30'
    );
  });

  test('is left out when several instances share the component', async () => {
    const {root} = await select(
      [...stamped(1, 'x-counter', 1, 0), ...stamped(3, 'x-counter', 1, 5)],
      '<x-counter>'
    );
    expect(root.querySelector('.call-site')).toBeNull();
  });

  test('is left out without a call site', async () => {
    const {root} = await select(tick(1, 'x-counter', 1, 0), '<x-counter>');
    expect(root.querySelector('.call-site')).toBeNull();
  });
});

describe('skipped updates', () => {
  /** A vetoed tick, as the runtime emits it. */
  const vetoed = (id: number, tagName: string, n: number, time: number) => [
    {
      layerId: 'lit-lifecycle',
      time,
      groupId: `${id}:${n}`,
      title: 'performUpdate:start',
      data: {phase: 'performUpdate'},
      meta: {elementId: id, tagName},
    },
    {
      layerId: 'lit-lifecycle',
      time: time + 0.5,
      groupId: `${id}:${n}`,
      title: 'update skipped',
      data: {phase: 'shouldUpdate', changed: ['count']},
      meta: {elementId: id, tagName},
    },
    {
      layerId: 'lit-lifecycle',
      time: time + 1,
      groupId: `${id}:${n}`,
      title: 'performUpdate:end',
      data: {phase: 'performUpdate'},
      meta: {elementId: id, tagName},
    },
  ];

  test('counts skips on the component row, apart from updates', async () => {
    const {rows, settle} = await mount();
    setEvents([
      ...tick(1, 'x-counter', 1, 0),
      ...vetoed(1, 'x-counter', 2, 10),
    ]);
    await settle();
    const {row} = rows()[0]!;
    expect(row.querySelector('.skipped')?.textContent?.trim()).toBe(
      '1 skipped'
    );
    expect(row.querySelector('.num wa-badge')?.textContent?.trim()).toBe('1×');
  });

  test('marks the skipped update in the component pane', async () => {
    const {rows, cycles, root, settle} = await mount();
    setEvents([
      ...tick(1, 'x-counter', 1, 0),
      ...vetoed(1, 'x-counter', 2, 10),
    ]);
    await settle();
    rows()[0]!.row.click();
    await settle();
    expect(cycles()).toHaveLength(2);
    expect(root.querySelectorAll('.cycles .skipped')).toHaveLength(1);
  });

  test('shows no skip badge when nothing was vetoed', async () => {
    const {root, settle} = await mount();
    setEvents(events);
    await settle();
    expect(root.querySelector('.skipped')).toBeNull();
  });
});
