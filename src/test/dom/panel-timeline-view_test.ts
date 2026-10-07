import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type WaSelect from '@awesome.me/webawesome/dist/components/select/select.js';
import type {TimelineView} from '../../panel/timeline-view.js';
import {
  DEFAULT_LAYERS_STATE,
  type TimelineEvent,
  type TimelineLayer,
} from '../../types/timeline.js';
import {calls, meta, resetClient, updateSharedState} from './fakes/client.js';
import {
  getTimelineEvents,
  resetStore,
  setEvents,
} from './fakes/timeline-store.js';

vi.mock('../../panel/client.js', () => import('./fakes/client.js'));
import {resetHostInfo} from '../../panel/host.js';
vi.mock(
  '../../panel/timeline-store.js',
  () => import('./fakes/timeline-store.js')
);

beforeAll(async () => {
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
  await import('../../panel/timeline-view.js');
});

const LAYERS: TimelineLayer[] = [
  {id: 'lit-lifecycle', label: 'Lifecycle', color: 0xff0000},
  {id: 'mouse', label: 'Mouse', color: 0x00ff00},
  {id: 'my-layer', label: 'Mine', color: 0x0000ff},
];

/** A start/end pair: one span, keyed `lit-lifecycle:<id>:1:update`. */
const pair = (elementId: number, time: number): TimelineEvent[] =>
  (['start', 'end'] as const).map((edge, i) => ({
    id: `${elementId}-${edge}`,
    layerId: 'lit-lifecycle',
    time: time + i,
    data: {},
    groupId: `${elementId}:1`,
    title: `update:${edge}`,
    meta: {elementId, tagName: `x-${elementId}`},
  }));
const events = [...pair(1, 0), ...pair(2, 10)];

const session = (recordingState: boolean) => ({
  layers: {...DEFAULT_LAYERS_STATE, recordingState},
  customLayers: [],
});

/** Lets the view's async connect, and the renders it causes, finish. */
const flush = async (el: TimelineView) => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
};

const mount = async (recording = false) => {
  meta.layers = LAYERS;
  updateSharedState('session', session(recording));
  const el = document.createElement('timeline-view');
  const changes = vi.fn();
  el.location.subscribe(changes);
  document.body.append(el);
  await flush(el);
  const root = el.shadowRoot!;
  const button = (text: string) =>
    [...root.querySelectorAll('wa-button')].find((b) =>
      b.textContent!.includes(text)
    )!;
  return {
    el,
    root,
    changes,
    button,
    list: () => root.querySelector('timeline-event-list')!,
    tracks: () => root.querySelector('timeline-tracks')!,
  };
};

afterEach(() => {
  document.body.replaceChildren();
  resetStore();
  resetClient();
  resetHostInfo();
});

test('Record asks the server to start recording', async () => {
  const {button} = await mount();
  button('Record').click();
  expect(calls).toContainEqual({
    name: 'set-recording',
    args: [{recording: true}],
  });
});

test('a recording start the panel watched clears the old events', async () => {
  const {el} = await mount(false);
  setEvents(events);
  updateSharedState('session', session(true));
  await flush(el);
  expect(getTimelineEvents()).toEqual([]);
});

test('joining a recording already under way keeps its events', async () => {
  setEvents(events);
  await mount(true);
  // The first state is the panel catching up, not a start.
  expect(getTimelineEvents()).toHaveLength(4);
});

test('a layer toggle goes to the server, except for custom layers', async () => {
  const {root} = await mount();
  const pills = root
    .querySelector('timeline-layers')!
    .shadowRoot!.querySelectorAll('wa-button');
  pills[1]!.click(); // mouse, off by default
  pills[2]!.click(); // custom: always on, nothing to toggle
  expect(calls.filter((c) => c.name === 'toggle-layer')).toEqual([
    {name: 'toggle-layer', args: [{layerId: 'mouse', enabled: true}]},
  ]);
});

test('a deep link before the events load waits, then selects', async () => {
  const {el, list} = await mount();
  el.location.apply({eventId: '2-end'});
  await flush(el);
  // Still held: nothing has loaded to match it against.
  expect(el.location.requested('timeline')).toBe('2-end');
  setEvents(events);
  await flush(el);
  expect(list().selectedKey).toBe('lit-lifecycle:2:1:update');
  // Resolved to the span's start event.
  expect(el.location.requested('timeline')).toBeUndefined();
  expect(el.location.selected('timeline')).toBe('2-start');
});

test('a link to an event the buffer does not hold selects nothing', async () => {
  const {el, list} = await mount();
  setEvents(events);
  await flush(el);
  el.location.apply({eventId: 'gone'});
  await flush(el);
  expect(list().selectedKey).toBeNull();
  expect(el.location.selected('timeline')).toBeNull();
});

test('a click in the list becomes the shared selection', async () => {
  const {el, changes, list, tracks} = await mount();
  setEvents(events);
  await flush(el);
  list().dispatchEvent(
    new CustomEvent('span-select', {
      detail: {key: 'lit-lifecycle:1:1:update'},
      bubbles: true,
      composed: true,
    })
  );
  await flush(el);
  expect(el.location.selected('timeline')).toBe('1-start');
  expect(tracks().selectedKey).toBe('lit-lifecycle:1:1:update');
  expect(changes).toHaveBeenCalledOnce();
});

test('the element filter reaches the tracks, and Clear drops it', async () => {
  const {el, root, button, tracks} = await mount();
  setEvents(events);
  await flush(el);
  const select = root.querySelector<WaSelect>('.filterbar wa-select')!;
  select.value = '2';
  select.dispatchEvent(new Event('change'));
  await flush(el);
  expect(tracks().spans.map((s) => s.meta?.elementId)).toEqual([2]);

  button('Clear').click();
  await flush(el);
  setEvents(events);
  await flush(el);
  // Element 2 was gone in between, so the filter no longer applies.
  expect(tracks().spans).toHaveLength(2);
});

test('offers Export snapshot only where the host can write one', async () => {
  expect((await mount()).root.querySelector('wa-button.export')).not.toBeNull();
  document.body.replaceChildren();
  meta.capabilities.exportSnapshot = false;
  // Another host: the panel reads it afresh.
  resetHostInfo();
  expect((await mount()).root.querySelector('wa-button.export')).toBeNull();
});

/** One `lit-lifecycle` event with no render event beside it. */
const lifecycleOnly = (): TimelineEvent[] => pair(1, 0);
const renderLayers = (): TimelineLayer[] => [
  ...LAYERS,
  {id: 'lit-render', label: 'Render', color: 0x325cff},
];

test('off Vite, explains render layers that stay empty', async () => {
  meta.capabilities.hmr = false;
  setEvents(lifecycleOnly());
  const {el, root} = await mount(true);
  // `mount` sets its own layers; add the render one and let it apply.
  meta.layers = renderLayers();
  el.remove();
  document.body.append(el);
  await flush(el);
  expect(root.querySelector('.hint')!.textContent).toContain(
    'production build'
  );
});

test('says nothing about render layers under Vite', async () => {
  setEvents(lifecycleOnly());
  const {el, root} = await mount(true);
  meta.layers = renderLayers();
  el.remove();
  document.body.append(el);
  await flush(el);
  expect(root.querySelector('.hint')).toBeNull();
});

test('opens in Tracks, and in List once the user left it there', async () => {
  localStorage.removeItem('lit-devtools-timeline-mode');
  const first = await mount();
  expect(first.tracks().hidden).toBe(false);
  expect(first.list().hidden).toBe(true);
  document.body.replaceChildren();

  localStorage.setItem('lit-devtools-timeline-mode', 'list');
  const again = await mount();
  expect(again.list().hidden).toBe(false);
  expect(again.tracks().hidden).toBe(true);
  localStorage.removeItem('lit-devtools-timeline-mode');
});
