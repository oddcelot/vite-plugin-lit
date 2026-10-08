import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {ComponentsView} from '../../panel/components-view.js';
import {
  ANATOMY_COLORS,
  type InspectorExtra,
  type InspectorTreeNode,
} from '../../types/inspector.js';
import {
  answers,
  calls,
  meta,
  push,
  resetClient,
  setSnapshot,
} from './fakes/client.js';

vi.mock('../../panel/client.js', () => import('./fakes/client.js'));
import {resetHostInfo} from '../../panel/host.js';
vi.mock('../../panel/in-page.js', () => import('./fakes/in-page.js'));

beforeAll(async () => {
  await import('../../panel/components-view.js');
});

const tree: InspectorTreeNode[] = [
  {
    id: 1,
    tagName: 'x-app',
    children: [{id: 2, tagName: 'x-button', children: []}],
  } as InspectorTreeNode,
];

const flush = async (el: ComponentsView) => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
};

const mount = async (picker = false, roots: InspectorTreeNode[] = tree) => {
  meta.picker = picker;
  // A fresh mount is a fresh panel: read the host again.
  resetHostInfo();
  answers.set('list-components', roots);
  answers.set('hmr-incompatibilities', []);
  if (!answers.has('hmr-history')) answers.set('hmr-history', {entries: []});
  const el = document.createElement('components-view');
  document.body.append(el);
  await flush(el);
  const root = el.shadowRoot!;
  return {
    el,
    root,
    pick: () => root.querySelector<HTMLElement>('wa-button.pick'),
    rows: () => [...root.querySelectorAll<HTMLElement>('.row')],
    inspects: () =>
      calls.filter((c) => c.name === 'inspect').map((c) => c.args[0]),
  };
};

const LIVE_LS_KEY = 'lit-devtools-components-live';
const WIDTH_LS_KEY = 'lit-devtools-components-details-width';
const COLLAPSED_LS_KEY = 'lit-devtools-components-collapsed';
const ANATOMY_LS_KEY = 'lit-devtools-components-anatomy';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.removeItem(LIVE_LS_KEY);
  localStorage.removeItem(WIDTH_LS_KEY);
  localStorage.removeItem(COLLAPSED_LS_KEY);
  localStorage.removeItem(ANATOMY_LS_KEY);
  resetClient();
  resetHostInfo();
});

test('offers Pick only when the page has a picker', async () => {
  expect((await mount(false)).pick()).toBeNull();
  document.body.replaceChildren();
  expect((await mount(true)).pick()).not.toBeNull();
});

test('never offers Pick in a snapshot', async () => {
  setSnapshot(true);
  expect((await mount(true)).pick()).toBeNull();
});

test('Pick starts the picker in the page', async () => {
  const {el, pick, inspects} = await mount(true);
  pick()!.click();
  await flush(el);
  expect(inspects()).toContainEqual({type: 'pick'});
  expect(pick()!.classList.contains('active')).toBe(true);
});

test('a pick from the page selects it and asks to be brought forward', async () => {
  const {el, pick, inspects} = await mount(true);
  pick()!.click();
  el.location.setTab('timeline');
  push('inspector-message', {type: 'pick', id: 2});
  await flush(el);
  expect(el.location.selected('components')).toBe(2);
  expect(inspects()).toContainEqual({type: 'details', id: 2});
  expect(el.location.tab).toBe('components');
  expect(pick()!.classList.contains('active')).toBe(false);
});

test('renders the tree it was primed with and selects on click', async () => {
  const {el, rows, inspects} = await mount();
  expect(rows().map((r) => r.querySelector('.tag')!.textContent)).toEqual([
    '<x-app>',
  ]);
  rows()[0]!.click();
  await flush(el);
  expect(el.location.selected('components')).toBe(1);
  expect(inspects()).toContainEqual({type: 'watch', id: 1});
});

test('selecting a nested element expands its ancestors', async () => {
  const {el, rows} = await mount();
  el.location.apply({componentId: 2});
  await flush(el);
  expect(rows().map((r) => r.querySelector('.tag')!.textContent)).toEqual([
    '<x-app>',
    '<x-button>',
  ]);
  expect(rows()[1]!.classList.contains('selected')).toBe(true);
});

const bigTree: InspectorTreeNode[] = [
  {
    id: 1,
    tagName: 'x-app',
    children: [
      {
        id: 2,
        tagName: 'x-header',
        children: [{id: 3, tagName: 'x-button', children: []}],
      },
      {
        id: 4,
        tagName: 'x-list',
        children: [
          {id: 5, tagName: 'x-item', children: []},
          {id: 6, tagName: 'x-item', children: []},
        ],
      },
    ],
  } as InspectorTreeNode,
];

const filterTree = async (el: ComponentsView, root: ShadowRoot, q: string) => {
  const input = root.querySelector<HTMLInputElement>('wa-input.tree-filter')!;
  input.value = q;
  input.dispatchEvent(new Event('input'));
  await flush(el);
};

const tags = (rows: HTMLElement[]) =>
  rows.map(
    (r) =>
      `${r.querySelector('.tag')!.textContent}${r.classList.contains('context') ? ' (context)' : ''}`
  );

test('the tree filter shows matches with their ancestors, opened', async () => {
  const {el, root, rows} = await mount(false, bigTree);
  expect(tags(rows())).toEqual(['<x-app>']);
  await filterTree(el, root, 'ITEM');
  expect(tags(rows())).toEqual([
    '<x-app> (context)',
    '<x-list> (context)',
    '<x-item>',
    '<x-item>',
  ]);
  expect(root.querySelector('.match-count')!.textContent).toBe('2');
  expect(
    [...root.querySelectorAll('.tree mark')].map((m) => m.textContent)
  ).toEqual(['item', 'item']);
});

test('clearing the tree filter brings back the expansion as it was', async () => {
  const {el, root, rows} = await mount(false, bigTree);
  await filterTree(el, root, 'button');
  expect(tags(rows())).toEqual([
    '<x-app> (context)',
    '<x-header> (context)',
    '<x-button>',
  ]);
  // The twisty is inert while filtering, so it cannot fold a path away.
  rows()[0]!.querySelector<HTMLElement>('.twisty')!.click();
  await flush(el);
  expect(rows()).toHaveLength(3);
  await filterTree(el, root, '');
  expect(tags(rows())).toEqual(['<x-app>']);
});

test('a tree filter with no match says so, and Escape clears it', async () => {
  const {el, root, rows} = await mount(false, bigTree);
  await filterTree(el, root, 'nope');
  expect(rows()).toHaveLength(0);
  expect(
    root
      .querySelector('.tree .no-match')!
      .textContent!.replace(/\s+/g, ' ')
      .trim()
  ).toBe('No elements match “nope”.');
  root
    .querySelector('wa-input.tree-filter')!
    .dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})
    );
  await flush(el);
  expect(tags(rows())).toEqual(['<x-app>']);
});

test('Shift-hover outlines every element with that tag', async () => {
  const {el, root, rows, inspects} = await mount(false, bigTree);
  await filterTree(el, root, 'item');
  const item = rows().find((r) => r.textContent!.includes('x-item'))!;
  item.dispatchEvent(new MouseEvent('mouseenter', {shiftKey: true}));
  await flush(el);
  expect(inspects().at(-1)).toEqual({type: 'highlight-all', ids: [5, 6]});
  expect(
    rows()
      .filter((r) => r.classList.contains('same-tag'))
      .map((r) => r.querySelector('.tag')!.textContent)
  ).toEqual(['<x-item>', '<x-item>']);

  // Letting go of Shift drops back to the one row under the pointer.
  window.dispatchEvent(new KeyboardEvent('keyup', {key: 'Shift'}));
  await flush(el);
  expect(inspects().at(-1)).toEqual({type: 'highlight', id: 5});
  expect(root.querySelector('.row.same-tag')).toBeNull();

  // And pressing it again goes back to all of them.
  window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Shift'}));
  await flush(el);
  expect(inspects().at(-1)).toEqual({type: 'highlight-all', ids: [5, 6]});

  root.querySelector('.tree')!.dispatchEvent(new MouseEvent('mouseleave'));
  await flush(el);
  expect(inspects().at(-1)).toEqual({type: 'highlight', id: null});
  expect(root.querySelector('.row.same-tag')).toBeNull();
});

test('Shift does nothing with no row under the pointer', async () => {
  const {el, inspects} = await mount(false, bigTree);
  const before = inspects().length;
  window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Shift'}));
  await flush(el);
  expect(inspects()).toHaveLength(before);
});

test('Anatomy stays on across a reload', async () => {
  const first = await mount(true);
  first.root.querySelector<HTMLElement>('wa-button.anatomy')!.click();
  await flush(first.el);
  expect(localStorage.getItem(ANATOMY_LS_KEY)).toBe('true');

  document.body.replaceChildren();
  const {el, root, inspects} = await mount(true);
  expect(
    root.querySelector('wa-button.anatomy')!.classList.contains('active')
  ).toBe(true);
  push('inspector-message', {type: 'pick', id: 2});
  await flush(el);
  // On again, so selecting draws the selection's anatomy straight away.
  expect(inspects()).toContainEqual({type: 'anatomy', id: 2});
});

test('Anatomy turned off stays off', async () => {
  localStorage.setItem(ANATOMY_LS_KEY, 'true');
  const {el, root} = await mount(true);
  root.querySelector<HTMLElement>('wa-button.anatomy')!.click();
  await flush(el);
  expect(localStorage.getItem(ANATOMY_LS_KEY)).toBe('false');
});

// The session's rules are `components-session_test.ts`'s; these check the
// element wires them to the page, the shell and storage.

test('pausing Live remembers it and pulls one fresh tree', async () => {
  const {el, root, inspects} = await mount();
  const before = inspects().length;
  root.querySelector<HTMLElement>('wa-button.live')!.click();
  await flush(el);
  expect(inspects().slice(before)).toEqual([
    {type: 'observe', enabled: false},
    {type: 'tree'},
  ]);
  expect(localStorage.getItem(LIVE_LS_KEY)).toBe('false');
});

test('never arms Live in a snapshot', async () => {
  setSnapshot(true);
  const {inspects} = await mount();
  expect(inspects()).toEqual([]);
});

const detailsFor = (extras?: InspectorExtra[]) => ({
  id: 2,
  tagName: 'x-button',
  attributes: [],
  properties: [],
  flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: false},
  ...(extras === undefined ? {} : {extras}),
});

test('lists instance state below the other tables', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: detailsFor([
      {
        kind: 'task',
        name: 'userTask',
        value: '[1, 2]',
        type: 'Task',
        status: 'complete',
      },
      {kind: 'signal', name: 'count', value: '7', type: 'Signal.State'},
    ]),
  });
  await flush(el);
  const details = root.querySelector('.details')!;
  const labels = [...details.querySelectorAll('.label')].map(
    (l) => l.textContent
  );
  expect(labels).toEqual(['Instance']);
  const rows = [...details.querySelectorAll('.entry')].map((r) =>
    [...r.querySelectorAll(':scope > .name, :scope > .val')].map((c) =>
      c.textContent!.replace(/\s+/g, ' ').trim()
    )
  );
  // The kind and a task's status follow the name.
  expect(rows).toEqual([
    ['userTasktaskcomplete', '[1, 2]'],
    ['countsignal', '7'],
  ]);
  expect(
    details.querySelector('.entry .status')!.classList.contains('task-complete')
  ).toBe(true);
});

test('tags a value with its type only where the preview does not show it', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  const prop = (name: string, value: string, type: string) => ({
    name,
    value,
    type,
    attribute: name,
    reflects: false,
    state: false,
  });
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      properties: [
        prop('label', '"Save"', 'string'),
        prop('items', '[1, 2, 3]', 'Array(3)'),
        prop('lookup', 'Map(2)', 'Map(2)'),
      ],
    },
  });
  await flush(el);
  const types = [...root.querySelectorAll('.details .entry')].map(
    (r) => r.querySelector('.type')?.textContent ?? null
  );
  expect(types).toEqual([null, 'Array(3)', null]);
});

test('badges the options a property sets beyond the defaults', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  const prop = (name: string, extra: object = {}) => ({
    name,
    value: '1',
    type: 'number',
    attribute: name,
    reflects: false,
    state: false,
    ...extra,
  });
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      properties: [
        prop('plain'),
        prop('custom', {options: ['hasChanged', 'converter']}),
        prop('manual', {
          attribute: false,
          options: ['noAccessor', 'useDefault'],
        }),
        prop('hidden', {attribute: false, state: true}),
      ],
    },
  });
  await flush(el);
  const badges = [...root.querySelectorAll('.details .entry')].map((r) =>
    [...r.querySelectorAll('wa-badge')].map((b) => b.textContent?.trim())
  );
  expect(badges).toEqual([
    [],
    ['hasChanged', 'converter'],
    ['no attr', 'noAccessor', 'useDefault'],
    [],
  ]);
});

const withAttributes = () => ({
  ...detailsFor([{kind: 'signal', name: 'count', value: '7', type: 'Signal'}]),
  attributes: [
    {name: 'a', value: '1'},
    {name: 'b', value: '2'},
  ],
});

const sections = (root: ShadowRoot) =>
  [
    ...root.querySelectorAll<HTMLDetailsElement>('.details details.section'),
  ].map(
    (s) =>
      `${s.querySelector('.label')!.textContent} ${s.querySelector('.count')!.textContent} ${s.open ? 'open' : 'folded'}`
  );

test('each section heading counts its rows', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: withAttributes()});
  await flush(el);
  expect(sections(root)).toEqual(['Attributes 2 open', 'Instance 1 open']);
});

test('a folded section stays folded, and is remembered', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: withAttributes()});
  await flush(el);
  const attrs = root.querySelector<HTMLDetailsElement>(
    'details[data-section="Attributes"]'
  )!;
  attrs.open = false;
  attrs.dispatchEvent(new Event('toggle'));
  await flush(el);
  expect(sections(root)).toEqual(['Attributes 2 folded', 'Instance 1 open']);
  expect(JSON.parse(localStorage.getItem(COLLAPSED_LS_KEY)!)).toEqual([
    'Attributes',
  ]);

  document.body.replaceChildren();
  const again = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: withAttributes()});
  await flush(again.el);
  expect(sections(again.root)).toEqual([
    'Attributes 2 folded',
    'Instance 1 open',
  ]);
});

const filterable = () => ({
  ...detailsFor([
    {kind: 'field', name: 'renders', value: '3', type: 'number'},
    {
      kind: 'task',
      name: 'userTask',
      value: '"Ada"',
      type: 'Task',
      status: 'complete',
    },
  ]),
  properties: [
    {
      name: 'label',
      value: '"Save"',
      type: 'string',
      attribute: 'label',
      reflects: false,
      state: false,
    },
    {
      name: 'userId',
      value: '1',
      type: 'number',
      attribute: false,
      reflects: false,
      state: true,
    },
  ],
  attributes: [{name: 'data-renders', value: '3'}],
});

const typeFilter = async (el: ComponentsView, root: ShadowRoot, q: string) => {
  const input = root.querySelector<HTMLInputElement>(
    '.details wa-input.filter'
  )!;
  input.value = q;
  input.dispatchEvent(new Event('input'));
  await flush(el);
};

const names = (root: ShadowRoot) =>
  [...root.querySelectorAll('.details .entry > .name')].map((n) =>
    n.textContent!.replace(/\s+/g, ' ').trim()
  );

test('the filter keeps rows whose name or value matches', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: filterable()});
  await flush(el);
  await typeFilter(el, root, 'USER');
  expect(sections(root)).toEqual(['State 1/1 open', 'Instance 1/2 open']);
  expect(names(root)).toEqual(['userId', 'userTasktaskcomplete']);
  expect(
    [...root.querySelectorAll('.details mark')].map((m) => m.textContent)
  ).toEqual(['user', 'user']);

  // A value match counts too: "Ada" is only in userTask's value.
  await typeFilter(el, root, 'ada');
  expect(names(root)).toEqual(['userTasktaskcomplete']);
});

test('a filter with no match says so', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: filterable()});
  await flush(el);
  await typeFilter(el, root, 'nope');
  expect(sections(root)).toEqual([]);
  expect(
    root
      .querySelector('.details .no-match')!
      .textContent!.replace(/\s+/g, ' ')
      .trim()
  ).toBe('No rows match “nope”.');
});

test('a folded section opens while filtering and folds again after', async () => {
  localStorage.setItem(COLLAPSED_LS_KEY, JSON.stringify(['Instance']));
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: filterable()});
  await flush(el);
  expect(sections(root)).toContain('Instance 2 folded');
  await typeFilter(el, root, 'renders');
  expect(sections(root)).toEqual(['Attributes 1/1 open', 'Instance 1/2 open']);
  // The forced open fires toggle; it must not count as unfolding.
  root
    .querySelector('details[data-section="Instance"]')!
    .dispatchEvent(new Event('toggle'));
  await typeFilter(el, root, '');
  expect(sections(root)).toContain('Instance 2 folded');
  expect(JSON.parse(localStorage.getItem(COLLAPSED_LS_KEY)!)).toEqual([
    'Instance',
  ]);
});

test('Escape clears the filter', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: filterable()});
  await flush(el);
  await typeFilter(el, root, 'user');
  root
    .querySelector('.details wa-input.filter')!
    .dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})
    );
  await flush(el);
  expect(names(root)).toHaveLength(5);
});

test('the filter stays set when another element is selected', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: filterable()});
  await flush(el);
  await typeFilter(el, root, 'label');
  push('inspector-message', {type: 'pick', id: 3});
  push('inspector-message', {
    type: 'details',
    details: {...filterable(), id: 3},
  });
  await flush(el);
  expect(
    root.querySelector<HTMLInputElement>('.details wa-input.filter')!.value
  ).toBe('label');
  expect(names(root)).toEqual(['label']);
});

test('filtering slots keeps each row on its own colour', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  const slot = (name: string, tag: string) => ({
    name,
    status: 'assigned' as const,
    elements: [{tagName: tag}],
    moreElements: 0,
    textNodes: 0,
    forwarded: false,
    duplicate: false,
  });
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      anatomy: {
        renderRoot: 'shadow',
        mode: 'open',
        slots: [slot('icon', 'svg'), slot('', 'p')],
        orphans: [],
        orphanText: 0,
        parts: [],
      },
    },
  });
  await flush(el);
  await typeFilter(el, root, 'default');
  expect(sections(root)).toEqual(['Slots 1/2 open']);
  const swatch = root.querySelector<HTMLElement>('.details .swatch')!;
  // Slot 1's colour, not slot 0's, though it is the only row left.
  expect(swatch.getAttribute('style')).toContain(ANATOMY_COLORS[1]);
});

test('a refresh highlights the rows whose value changed', async () => {
  const animate = vi.fn();
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'animate'
  );
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    value: animate,
    configurable: true,
  });
  try {
    const {el} = await mount(true);
    push('inspector-message', {type: 'pick', id: 2});
    push('inspector-message', {type: 'details', details: filterable()});
    await flush(el);
    // The first snapshot of a selection changes nothing.
    expect(animate).not.toHaveBeenCalled();

    const next = filterable();
    next.properties[1] = {...next.properties[1]!, value: '2'};
    next.attributes = [{name: 'data-renders', value: '4'}];
    push('inspector-message', {type: 'details', details: next});
    await flush(el);
    const flashed = animate.mock.contexts.map(
      (row) => (row as HTMLElement).dataset['key']
    );
    expect(flashed).toEqual(['p:userId', 'a:data-renders']);
  } finally {
    if (original === undefined) {
      delete (HTMLElement.prototype as {animate?: unknown}).animate;
    } else {
      Object.defineProperty(HTMLElement.prototype, 'animate', original);
    }
  }
});

const expandable = () => ({
  ...detailsFor(),
  properties: [
    {
      name: 'config',
      value: '{theme: {mode: "dark"}}',
      type: 'object',
      attribute: false as const,
      reflects: false,
      state: false,
      expandable: true,
    },
    {
      name: 'label',
      value: '"Save"',
      type: 'string',
      attribute: 'label',
      reflects: false,
      state: false,
    },
  ],
});

const configPath = (...keys: Array<string | number>) => ({
  section: 'prop' as const,
  name: 'config',
  keys,
});

test('an expandable value opens to its children on demand', async () => {
  const {el, root, inspects} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: expandable()});
  await flush(el);
  const expanders = root.querySelectorAll<HTMLElement>('.details .expander');
  // Only the object expands; a string has nothing under it.
  expect(expanders).toHaveLength(1);
  expanders[0]!.click();
  await flush(el);
  expect(inspects()).toContainEqual({
    type: 'expand',
    id: 2,
    path: configPath(),
  });
  expect(root.querySelector('.details .children')!.textContent!.trim()).toBe(
    '…'
  );

  push('inspector-message', {
    type: 'expanded',
    id: 2,
    path: configPath(),
    children: [
      {
        label: 'theme',
        key: 'theme',
        value: '{mode: "dark"}',
        type: 'object',
        expandable: true,
      },
      {
        label: 'size',
        key: 'size',
        value: '3',
        type: 'number',
        expandable: false,
      },
    ],
    more: 4,
  });
  await flush(el);
  const children = [
    ...root.querySelectorAll('.details .children > .child'),
  ].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
  expect(children).toEqual(['theme: {mode: "dark"}', 'size: 3', '+4 more']);
  // The open row shows its type in place of the preview.
  expect(
    root.querySelector('.details .entry[data-key="p:config"] .val > .t-type')!
      .textContent
  ).toBe('Object');

  root.querySelector<HTMLElement>('.details .child .expander')!.click();
  await flush(el);
  expect(inspects()).toContainEqual({
    type: 'expand',
    id: 2,
    path: configPath('theme'),
  });
});

test('a changed value asks again for what is open under it', async () => {
  const {el, root, inspects} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: expandable()});
  await flush(el);
  root.querySelector<HTMLElement>('.details .expander')!.click();
  await flush(el);
  const expands = () =>
    inspects().filter((c) => (c as {type: string}).type === 'expand');
  const before = expands().length;
  const next = expandable();
  next.properties[0] = {
    ...next.properties[0]!,
    value: '{theme: {mode: "light"}}',
  };
  push('inspector-message', {type: 'details', details: next});
  await flush(el);
  expect(expands()).toHaveLength(before + 1);
});

test('a snapshot cannot expand values', async () => {
  setSnapshot(true);
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: expandable()});
  await flush(el);
  expect(root.querySelector('.details .expander')).toBeNull();
});

test('a row copies its value as shown, an attribute without quotes', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: {writeText},
    configurable: true,
  });
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: filterable()});
  await flush(el);
  const copyOf = (key: string) =>
    root.querySelector<HTMLElement>(
      `.details .entry[data-key="${key}"] .copy`
    )!;

  copyOf('p:label').click();
  await flush(el);
  copyOf('a:data-renders').click();
  await flush(el);
  expect(writeText.mock.calls).toEqual([['"Save"'], ['3']]);
  // The last one copied says so until the moment passes.
  expect(copyOf('a:data-renders').classList.contains('copied')).toBe(true);
  expect(copyOf('p:label').classList.contains('copied')).toBe(false);
});

test('a refused clipboard falls back to a selected textarea', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {writeText: vi.fn(async () => Promise.reject(new Error('denied')))},
    configurable: true,
  });
  const exec = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', {
    value: exec,
    configurable: true,
  });
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: filterable()});
  await flush(el);
  root
    .querySelector<HTMLElement>('.details .entry[data-key="p:label"] .copy')!
    .click();
  await flush(el);
  expect(exec).toHaveBeenCalledWith('copy');
  expect(document.querySelector('textarea')).toBeNull();
  expect(
    root
      .querySelector('.details .entry[data-key="p:label"] .copy')!
      .classList.contains('copied')
  ).toBe(true);
});

test('attribute values read as quoted strings', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      attributes: [{name: 'data-renders', value: '2'}],
    },
  });
  await flush(el);
  const val = root.querySelector('.details .entry .val')!;
  expect(val.textContent).toBe('"2"');
  expect(val.querySelector('.t-string')!.textContent).toBe('"2"');
});

test('a long value takes its own line under the name', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      attributes: [
        {name: 'short', value: 'a'},
        {name: 'long', value: 'x'.repeat(60)},
      ],
    },
  });
  await flush(el);
  const wide = [...root.querySelectorAll('.details .entry')].map((r) =>
    r.classList.contains('wide')
  );
  expect(wide).toEqual([false, true]);
});

test('Scroll into view reveals the selected element in the page', async () => {
  const {el, root, inspects} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: detailsFor([])});
  await flush(el);
  root.querySelector<HTMLElement>('.details wa-button.reveal')!.click();
  expect(inspects()).toContainEqual({type: 'reveal', id: 2});
});

test('never offers Scroll into view in a snapshot', async () => {
  setSnapshot(true);
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: detailsFor([])});
  await flush(el);
  expect(root.querySelector('.details h2')).not.toBeNull();
  expect(root.querySelector('wa-button.reveal')).toBeNull();
});

test('shows no Instance section without extras', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: detailsFor()});
  await flush(el);
  expect(root.querySelector('.details h2')!.textContent).toBe('<x-button>');
  expect(root.querySelector('.details .label')).toBeNull();
});

const metaRows = (root: ShadowRoot) =>
  [...root.querySelectorAll('.details .meta dt')].map(
    (dt) => `${dt.textContent} ${dt.nextElementSibling!.textContent!.trim()}`
  );

const statuses = (root: ShadowRoot) =>
  [...root.querySelectorAll('.details .head .status')].map(
    (s) => s.textContent
  );

test('a settled element shows no status next to its tag', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: detailsFor()});
  await flush(el);
  expect(statuses(root)).toEqual([]);
});

test('a queued or first update shows as a status next to the tag', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      flags: {hasUpdated: false, isUpdatePending: true, hasShadowRoot: true},
    },
  });
  await flush(el);
  expect(statuses(root)).toEqual(['pending', 'not rendered']);
});

test('the render root reads as one line under the locations', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      source: {file: 'src/b.ts', line: 4},
      anatomy: {
        renderRoot: 'shadow',
        mode: 'open',
        delegatesFocus: true,
        slots: [],
        orphans: [],
        orphanText: 0,
        parts: [],
      },
    },
  });
  await flush(el);
  expect(metaRows(root)).toEqual([
    'defined src/b.ts:4',
    'root shadow, open, delegatesFocus',
  ]);
});

test('a light DOM element says so', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      anatomy: {
        renderRoot: 'light',
        slots: [],
        orphans: [],
        orphanText: 0,
        parts: [],
      },
    },
  });
  await flush(el);
  expect(metaRows(root)).toEqual(['root light DOM']);
});

const emptyText = async () => {
  const {el, root} = await mount(false, []);
  return {
    el,
    text: () =>
      root.querySelector('.empty')!.textContent!.replace(/\s+/g, ' ').trim(),
  };
};

test('says the runtime has not connected when no runtime ever announced', async () => {
  meta.runtime = {
    ready: false,
    litPackages: {},
    topFrame: true,
    chromeTracks: true,
  };
  const {el, text} = await emptyText();
  expect(text()).toContain('has not connected');

  // The runtime arriving later replaces the diagnosis.
  push('inspector-message', {
    type: 'ready',
    litPackages: {'lit-element': ['4.2.2']},
    topFrame: true,
  });
  await flush(el);
  expect(text()).toBe('No Lit components found on the page.');
});

test('names both versions when more than one copy of lit is loaded', async () => {
  meta.runtime = {
    ready: true,
    litPackages: {'lit-element': ['4.2.2', '4.1.0']},
    topFrame: true,
    chromeTracks: true,
  };
  const {text} = await emptyText();
  expect(text()).toContain('More than one copy of lit');
  expect(text()).toContain('lit-element 4.2.2, 4.1.0');
});

test('explains an empty tree inside an iframe', async () => {
  meta.runtime = {
    ready: true,
    litPackages: {'lit-element': ['4.2.2']},
    topFrame: false,
    chromeTracks: true,
  };
  expect((await emptyText()).text()).toContain('iframe');
});

test('keeps the plain message for a healthy runtime with no components', async () => {
  expect((await emptyText()).text()).toBe(
    'No Lit components found on the page.'
  );
});

test('never blames the runtime in a snapshot', async () => {
  setSnapshot(true);
  meta.runtime = {
    ready: false,
    litPackages: {},
    topFrame: true,
    chromeTracks: true,
  };
  expect((await emptyText()).text()).toBe(
    'No Lit components found on the page.'
  );
});

test('does not add a diagnosis to a tree that has components', async () => {
  meta.runtime = {
    ready: false,
    litPackages: {},
    topFrame: true,
    chromeTracks: true,
  };
  const {root} = await mount();
  expect(root.querySelector('.empty')).toBeNull();
});

const patched = {
  tagName: 'x-button',
  instances: 3,
  generation: 1,
  durationMs: 4.2,
  childState: 'transfer' as const,
  at: Date.now(),
};

/** Visible text of the latest-patch line with whitespace collapsed. */
const patchLine = (root: ShadowRoot): string | undefined =>
  root
    .querySelector('.hmr-last-patch')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();

test('shows no patch line until a patch has landed', async () => {
  const {root} = await mount();
  expect(root.querySelector('.hmr-last-patch')).toBeNull();
});

test('a pushed patch shows its line, and a later one replaces it', async () => {
  const {el, root} = await mount();
  push('hmr-patched', patched);
  await flush(el);
  expect(patchLine(root)).toContain(
    'Patched <x-button> ×3 in 4.2 ms (childState: transfer)'
  );
  push('hmr-patched', {...patched, tagName: 'x-card', instances: 1});
  await flush(el);
  expect(patchLine(root)).toContain('Patched <x-card> ×1 in 4.2 ms');
  expect(root.querySelectorAll('.hmr-last-patch')).toHaveLength(1);
});

test('primes the patch line from the history, skipping failures', async () => {
  answers.set('hmr-history', {
    entries: [
      {kind: 'patched', at: 1, patch: patched},
      {
        kind: 'incompatible',
        at: 2,
        incompatibility: {
          tagName: 'x-card',
          time: 2,
          reason: {code: 'attributes-changed'},
          action: 'none',
        },
      },
    ],
  });
  const {root} = await mount();
  expect(patchLine(root)).toContain('Patched <x-button> ×3');
});

test('a patch does not count toward the HMR issue badge', async () => {
  const {el} = await mount();
  push('hmr-patched', patched);
  await flush(el);
  expect(el.hmrIncompatibilityCount).toBe(0);
});

const splitOf = (root: ShadowRoot) =>
  root.querySelector<HTMLElement>('wa-split-panel')!;

test('the details pane starts at 340px and keeps its width on resize', async () => {
  const {root} = await mount();
  const split = splitOf(root);
  expect(split.getAttribute('position-in-pixels')).toBe('340');
  expect(split.getAttribute('primary')).toBe('end');
  expect(split.querySelector('[slot="end"]')!.classList).toContain('details');
});

test('restores a remembered details width and ignores a bad one', async () => {
  localStorage.setItem(WIDTH_LS_KEY, '412');
  const {root} = await mount();
  expect(splitOf(root).getAttribute('position-in-pixels')).toBe('412');
  document.body.replaceChildren();
  for (const bad of ['nope', '12', '-5', '']) {
    localStorage.setItem(WIDTH_LS_KEY, bad);
    const {root: r} = await mount();
    expect(splitOf(r).getAttribute('position-in-pixels')).toBe('340');
    document.body.replaceChildren();
  }
});

test('remembers the details width after a drag', async () => {
  const {root} = await mount();
  const split = splitOf(root) as HTMLElement & {positionInPixels: number};
  split.positionInPixels = 275;
  split.dispatchEvent(new Event('wa-reposition'));
  expect(localStorage.getItem(WIDTH_LS_KEY)).toBe('275');
});

test('a source location opens in the editor where the host has one', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {...detailsFor(), source: {file: 'src/b.ts', line: 4}},
  });
  await flush(el);
  expect(root.querySelector('button.src')!.textContent).toContain('src/b.ts:4');
});

test('a source location is plain text where the host has no editor', async () => {
  meta.capabilities.openInEditor = false;
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {...detailsFor(), source: {file: 'src/b.ts', line: 4}},
  });
  await flush(el);
  expect(root.querySelector('button.src')).toBeNull();
  expect(root.querySelector('.src-text')!.textContent).toBe('src/b.ts:4');
});

test('a call site renders a second link that opens at its column', async () => {
  const {el, root} = await mount(true);
  answers.set('open-source', {opened: true});
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      source: {file: 'src/b.ts', line: 4},
      callSite: {file: 'src/app.ts', line: 12, column: 7},
    },
  });
  await flush(el);
  const link = root.querySelector<HTMLElement>('button.call-site')!;
  expect(link.textContent).toContain('src/app.ts:12');
  link.click();
  await flush(el);
  expect(calls.find((c) => c.name === 'open-source')?.args).toEqual([
    {file: 'src/app.ts', line: 12, column: 7},
  ]);
});

test('a call site is plain text where the host has no editor', async () => {
  meta.capabilities.openInEditor = false;
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      callSite: {file: 'src/app.ts', line: 12, column: 7},
    },
  });
  await flush(el);
  expect(root.querySelector('button.call-site')).toBeNull();
  expect(root.querySelector('.call-site')!.textContent).toBe('src/app.ts:12');
});

test('no call site, no row', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {...detailsFor(), source: {file: 'src/b.ts', line: 4}},
  });
  await flush(el);
  expect(root.querySelector('.call-site')).toBeNull();
});

test('badges a component Lit warned about and lists the warning', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      warnings: [
        {
          code: 'change-in-update',
          message: 'Element x-button scheduled an update after an update.',
        },
      ],
    },
  });
  await flush(el);
  expect(root.querySelector('.details .head .status.warned')?.textContent).toBe(
    '1 warning'
  );
  expect(sections(root)).toEqual(['Warnings 1 open']);
  const code = root.querySelector<HTMLAnchorElement>('.details .warning .code');
  expect(code?.textContent).toBe('change-in-update');
  expect(code?.href).toBe('https://lit.dev/msg/change-in-update');
  expect(root.querySelector('.details .warning .text')?.textContent).toContain(
    'x-button scheduled'
  );
});

test('shows no warning badge or section without warnings', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: detailsFor()});
  await flush(el);
  expect(root.querySelector('.details .status.warned')).toBeNull();
  expect(sections(root)).toEqual([]);
});

test('marks a tag nothing defines in its row', async () => {
  const {rows} = await mount(false, [
    {id: 1, tagName: 'x-app', children: []},
    {id: 2, tagName: 'x-missing', notDefined: true, children: []},
  ]);
  const [app, missing] = rows();
  expect(app!.querySelector('.status.undefined')).toBeNull();
  expect(missing!.querySelector('.status.undefined')?.textContent).toBe(
    'not defined'
  );
});

test('explains an undefined element in the details pane', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {
    type: 'details',
    details: {
      ...detailsFor(),
      tagName: 'x-missing',
      notDefined: true,
      callSite: {file: 'src/app.ts', line: 12},
      flags: {hasUpdated: false, isUpdatePending: false, hasShadowRoot: false},
    },
  });
  await flush(el);
  expect(
    root.querySelector('.details .head .status.undefined')?.textContent
  ).toBe('not defined');
  // An element that never upgraded has not "failed to render".
  expect(
    root.querySelector('.details .head .status:not(.undefined)')
  ).toBeNull();
  expect(root.querySelector('.not-defined-note')?.textContent).toContain(
    "customElements.define('x-missing')"
  );
  expect(root.querySelector('.call-site')?.textContent).toContain(
    'src/app.ts:12'
  );
  expect(sections(root)).toEqual([]);
});
