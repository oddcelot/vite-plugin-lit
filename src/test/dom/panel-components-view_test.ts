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

afterEach(() => {
  document.body.replaceChildren();
  localStorage.removeItem(LIVE_LS_KEY);
  localStorage.removeItem(WIDTH_LS_KEY);
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
  const rows = [...details.querySelectorAll('tr')].map((r) =>
    r.textContent!.replace(/\s+/g, ' ').trim()
  );
  // The badges sit flush against the name, so the cell text runs together.
  expect(rows).toEqual(['userTasktaskcomplete [1, 2]', 'countsignal 7']);
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
