import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {ComponentsView} from '../../panel/components-view.js';
import type {InspectorExtra, InspectorTreeNode} from '../../types/inspector.js';
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

const mount = async (picker = false, roots: InspectorTreeNode[] = tree) => {
  meta.picker = picker;
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

afterEach(() => {
  document.body.replaceChildren();
  localStorage.removeItem(LIVE_LS_KEY);
  localStorage.removeItem(WIDTH_LS_KEY);
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

const observeOn = {type: 'observe', enabled: true};

test('arms Live on connect by default', async () => {
  const {inspects} = await mount();
  expect(inspects()).toContainEqual(observeOn);
});

test('does not arm Live on connect when it was paused', async () => {
  localStorage.setItem(LIVE_LS_KEY, 'false');
  const {inspects} = await mount();
  expect(inspects()).not.toContainEqual(observeOn);
});

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

test('re-arms Live when the runtime announces ready', async () => {
  const {el, inspects} = await mount();
  const armed = () =>
    inspects().filter((c) => JSON.stringify(c) === JSON.stringify(observeOn))
      .length;
  const before = armed();
  push('inspector-message', {type: 'ready'});
  await flush(el);
  expect(armed()).toBe(before + 1);
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
  const rows = [...details.querySelectorAll('tr')].map((r) =>
    r.textContent!.replace(/\s+/g, ' ').trim()
  );
  // The badges sit flush against the name, so the cell text runs together.
  expect(rows).toEqual(['userTasktaskcomplete [1, 2]', 'countsignal 7']);
});

test('shows no Instance section without extras', async () => {
  const {el, root} = await mount(true);
  push('inspector-message', {type: 'pick', id: 2});
  push('inspector-message', {type: 'details', details: detailsFor()});
  await flush(el);
  expect(root.querySelector('.details h2')!.textContent).toBe('<x-button>');
  expect(root.querySelector('.details .label')).toBeNull();
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
  meta.runtime = {ready: false, litVersions: [], topFrame: true};
  const {el, text} = await emptyText();
  expect(text()).toContain('has not connected');

  // The runtime arriving later replaces the diagnosis.
  push('inspector-message', {
    type: 'ready',
    litVersions: ['3.3.3'],
    topFrame: true,
  });
  await flush(el);
  expect(text()).toBe('No Lit components found on the page.');
});

test('names both versions when more than one copy of lit is loaded', async () => {
  meta.runtime = {ready: true, litVersions: ['3.3.3', '3.2.0'], topFrame: true};
  const {text} = await emptyText();
  expect(text()).toContain('More than one copy of lit');
  expect(text()).toContain('3.3.3, 3.2.0');
});

test('explains an empty tree inside an iframe', async () => {
  meta.runtime = {ready: true, litVersions: ['3.3.3'], topFrame: false};
  expect((await emptyText()).text()).toContain('iframe');
});

test('keeps the plain message for a healthy runtime with no components', async () => {
  expect((await emptyText()).text()).toBe(
    'No Lit components found on the page.'
  );
});

test('never blames the runtime in a snapshot', async () => {
  setSnapshot(true);
  meta.runtime = {ready: false, litVersions: [], topFrame: true};
  expect((await emptyText()).text()).toBe(
    'No Lit components found on the page.'
  );
});

test('does not add a diagnosis to a tree that has components', async () => {
  meta.runtime = {ready: false, litVersions: [], topFrame: true};
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
