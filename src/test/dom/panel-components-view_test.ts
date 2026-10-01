import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {ComponentsView} from '../../panel/components-view.js';
import type {InspectorTreeNode} from '../../types/inspector.js';
import {
  answers,
  calls,
  meta,
  push,
  resetClient,
  setSnapshot,
} from './fakes/client.js';

vi.mock('../../panel/client.js', () => import('./fakes/client.js'));
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

const mount = async (picker = false) => {
  meta.picker = picker;
  answers.set('list-components', tree);
  answers.set('hmr-incompatibilities', []);
  const el = document.createElement('components-view');
  document.body.append(el);
  await flush(el);
  const root = el.shadowRoot!;
  return {
    el,
    root,
    pick: () => root.querySelector<HTMLButtonElement>('button.pick'),
    rows: () => [...root.querySelectorAll<HTMLElement>('.row')],
    inspects: () =>
      calls.filter((c) => c.name === 'inspect').map((c) => c.args[0]),
  };
};

afterEach(() => {
  document.body.replaceChildren();
  resetClient();
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
  const activated = vi.fn();
  document.body.addEventListener('inspector-activate', activated);
  push('inspector-message', {type: 'pick', id: 2});
  await flush(el);
  expect(el.selectedId).toBe(2);
  expect(inspects()).toContainEqual({type: 'details', id: 2});
  expect(activated).toHaveBeenCalledOnce();
  expect(pick()!.classList.contains('active')).toBe(false);
});

test('renders the tree it was primed with and selects on click', async () => {
  const {el, rows, inspects} = await mount();
  expect(rows().map((r) => r.querySelector('.tag')!.textContent)).toEqual([
    '<x-app>',
  ]);
  const changes: unknown[] = [];
  el.addEventListener('selection-change', (e) =>
    changes.push((e as CustomEvent<{id: number}>).detail.id)
  );
  rows()[0]!.click();
  await flush(el);
  expect(changes).toEqual([1]);
  expect(inspects()).toContainEqual({type: 'watch', id: 1});
});

test('selecting a nested element expands its ancestors', async () => {
  const {el, rows} = await mount();
  el.selectById(2);
  await flush(el);
  expect(rows().map((r) => r.querySelector('.tag')!.textContent)).toEqual([
    '<x-app>',
    '<x-button>',
  ]);
  expect(rows()[1]!.classList.contains('selected')).toBe(true);
});
