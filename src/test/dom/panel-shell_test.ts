import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {ComponentsView} from '../../panel/components-view.js';
import type {TimelineView} from '../../panel/timeline-view.js';
import type {UpdatesView} from '../../panel/updates-view.js';
import type {TimelineEvent} from '../../types/timeline.js';
import {
  answers,
  push,
  resetClient,
  setSnapshot,
  updateSharedState,
} from './fakes/client.js';
import {
  getTimelineEvents,
  resetStore,
  setEvents,
} from './fakes/timeline-store.js';

vi.mock('../../panel/client.js', () => import('./fakes/client.js'));
vi.mock(
  '../../panel/timeline-store.js',
  () => import('./fakes/timeline-store.js')
);
vi.mock('../../panel/in-page.js', () => import('./fakes/in-page.js'));

/**
 * Each shell listens for `hashchange` on `window` for good: in the app it is
 * the root and never goes away. Here every test mounts a new one, and
 * happy-dom (unlike a browser) fires `hashchange` on `replaceState`, so the
 * shells left behind would answer each other's hash writes forever. Track the
 * listeners and drop them with their shell.
 */
const hashListeners: EventListenerOrEventListenerObject[] = [];

beforeAll(async () => {
  const add = window.addEventListener.bind(window);
  window.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    if (type === 'hashchange') hashListeners.push(listener);
    add(type, listener, options);
  }) as typeof window.addEventListener;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // See panel-timeline-event-list_test.ts.
  if (!('assignedSlot' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'assignedSlot', {
      configurable: true,
      get: () => null,
    });
  }
  await import('../../panel/lit-devtools-panel.js');
});

const events: TimelineEvent[] = (['start', 'end'] as const).map((edge, i) => ({
  id: `e-${edge}`,
  layerId: 'lit-lifecycle',
  time: i,
  data: {},
  groupId: '1:1',
  title: `performUpdate:${edge}`,
  meta: {elementId: 1, tagName: 'x-app'},
}));

const flush = async (el: HTMLElement & {updateComplete: Promise<unknown>}) => {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
};

const mount = async (hash = '') => {
  history.replaceState(null, '', hash === '' ? location.pathname : hash);
  answers.set('list-components', [{id: 1, tagName: 'x-app', children: []}]);
  answers.set('hmr-incompatibilities', []);
  // The hub always holds an activation slot, empty until a dock is raised.
  updateSharedState('devframe:docks:active', {activation: null});
  updateSharedState('session', {
    layers: {recordingState: false},
    customLayers: [],
  });
  const el = document.createElement('lit-devtools-panel');
  document.body.append(el);
  await flush(el);
  const root = el.shadowRoot!;
  const view = <T extends HTMLElement>(tag: string) =>
    root.querySelector(tag) as T | null;
  const shown = () =>
    ['timeline-view', 'components-view', 'updates-view', 'devtools-settings']
      .filter((tag) => {
        const v = root.querySelector(tag);
        return v !== null && !v.hasAttribute('hidden');
      })
      .map((tag) => tag.replace(/-view$/, ''));
  return {el, root, view, shown, hash: () => location.hash};
};

afterEach(async () => {
  document.body.replaceChildren();
  for (const listener of hashListeners.splice(0)) {
    window.removeEventListener('hashchange', listener);
  }
  // A removed shell can still be finishing async work, and it syncs the URL
  // hash when it does; let that land before the hash is reset, or the next
  // test's shell opens on this one's link.
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  resetStore();
  resetClient();
  history.replaceState(null, '', location.pathname);
});

test('opens on Components with no link', async () => {
  const {shown} = await mount();
  expect(shown()).toEqual(['components']);
});

test('a component link selects it on Components', async () => {
  const {shown, view} = await mount('#tab=components&component=1');
  expect(shown()).toEqual(['components']);
  expect(view<ComponentsView>('components-view')!.selectedId).toBe(1);
});

test('a component link can name the Updates tab instead', async () => {
  setEvents(events);
  const {shown, view} = await mount('#tab=updates&component=1');
  expect(shown()).toEqual(['updates']);
  expect(view<UpdatesView>('updates-view')!.selectedId).toBe(1);
});

test('an event link opens the Timeline on it', async () => {
  setEvents(events);
  const {el, shown, view, hash} = await mount('#event=e-end');
  expect(shown()).toEqual(['timeline']);
  expect(view<TimelineView>('timeline-view')!.selectedEventId).toBe('e-start');
  await flush(el);
  expect(hash()).toContain('event=e-start');
});

test('inspect from another view switches to Components on it', async () => {
  const {el, shown, view, hash} = await mount('#tab=timeline');
  view('timeline-view')!.dispatchEvent(
    new CustomEvent('inspect-element', {
      detail: {id: 1},
      bubbles: true,
      composed: true,
    })
  );
  await flush(el);
  expect(shown()).toEqual(['components']);
  expect(view<ComponentsView>('components-view')!.selectedId).toBe(1);
  expect(hash()).toContain('tab=components');
  expect(hash()).toContain('component=1');
});

test('the hub activating the dock with params is a link too', async () => {
  const {el, view} = await mount();
  expect(view<ComponentsView>('components-view')!.selectedId).toBeNull();
  updateSharedState('devframe:docks:active', {
    activation: {dockId: 'other', params: {componentId: 1}},
  });
  await flush(el);
  expect(view<ComponentsView>('components-view')!.selectedId).toBeNull();
  updateSharedState('devframe:docks:active', {
    activation: {dockId: 'lit', params: {componentId: 1}},
  });
  await flush(el);
  expect(view<ComponentsView>('components-view')!.selectedId).toBe(1);
});

const pageChanged = {
  previousPageId: 'a',
  pageId: 'b',
  reload: false,
  at: Date.now(),
};

test('says so when the followed page changes, until dismissed', async () => {
  setEvents(events);
  const {el, root} = await mount();
  expect(root.querySelector('.page-changed')).toBeNull();
  push('page-changed', pageChanged);
  await flush(el);
  expect(root.querySelector('.page-changed')?.textContent).toContain(
    'Another page connected'
  );
  expect(getTimelineEvents()).toEqual([]);
  root.querySelector<HTMLButtonElement>('.page-changed button')!.click();
  await flush(el);
  expect(root.querySelector('.page-changed')).toBeNull();
});

test('a reload clears the timeline without a banner', async () => {
  setEvents(events);
  const {el, root} = await mount();
  push('page-changed', {...pageChanged, reload: true});
  await flush(el);
  expect(getTimelineEvents()).toEqual([]);
  expect(root.querySelector('.page-changed')).toBeNull();
});

test('a frozen session has no page to follow', async () => {
  setSnapshot(true);
  const {el, root} = await mount();
  push('page-changed', pageChanged);
  await flush(el);
  expect(root.querySelector('.page-changed')).toBeNull();
});
