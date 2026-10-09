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
    .shadowRoot!.querySelectorAll('button');
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

/** What the tracks report after a Shift+drag or a drag on the ruler. */
const drawRange = async (
  el: TimelineView,
  tracks: Element,
  range: {start: number; end: number} | null
) => {
  tracks.dispatchEvent(
    new CustomEvent('range-change', {
      detail: {range},
      bubbles: true,
      composed: true,
    })
  );
  await flush(el);
};

test('a drawn range is summarised in the tracks detail pane', async () => {
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 9, end: 20});
  expect(tracks().range).toEqual({start: 9, end: 20});
  const summary = tracks().shadowRoot!.querySelector('timeline-range-summary')!;
  expect(summary.summary?.spanCount).toBe(1);
  expect(summary.summary?.components.map((c) => c.tagName)).toEqual(['x-2']);
  expect(summary.shadowRoot!.textContent).toContain('<x-2>');
});

test('selecting a span replaces the range summary, and a range drops the span', async () => {
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 0, end: 20});
  tracks().dispatchEvent(
    new CustomEvent('span-select', {
      detail: {key: 'lit-lifecycle:1:1:update'},
      bubbles: true,
      composed: true,
    })
  );
  await flush(el);
  const root = tracks().shadowRoot!;
  expect(root.querySelector('timeline-span-detail')).not.toBeNull();
  expect(root.querySelector('timeline-range-summary')).toBeNull();
  await drawRange(el, tracks(), {start: 0, end: 20});
  expect(tracks().selectedKey).toBeNull();
  expect(root.querySelector('timeline-range-summary')).not.toBeNull();
});

test('Filter to range narrows both views and the chip clears it', async () => {
  const {el, root, tracks, list} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 9, end: 20});
  tracks()
    .shadowRoot!.querySelector('timeline-range-summary')!
    .shadowRoot!.querySelector<HTMLElement>('wa-button.filter')!
    .click();
  await flush(el);
  expect(tracks().spans.map((s) => s.meta?.elementId)).toEqual([2]);
  expect(list().filter.range).toEqual({start: 9, end: 20});
  root.querySelector<HTMLElement>('.range-chip')!.click();
  await flush(el);
  expect(tracks().spans).toHaveLength(2);
  expect(root.querySelector('.range-chip')).toBeNull();
});

test('Esc clears the range, Clear events too', async () => {
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 9, end: 20});
  window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  await flush(el);
  expect(tracks().range).toBeNull();
});

test('the summary inspects and filters a component by its element', async () => {
  const {el, tracks, root} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 9, end: 20});
  const summary = tracks().shadowRoot!.querySelector('timeline-range-summary')!;
  summary.shadowRoot!.querySelector<HTMLElement>('.filter-link')!.click();
  await flush(el);
  expect(root.querySelector('wa-select')!.value).toBe('2');
});

test('Esc typed in the filter box keeps the range', async () => {
  const {el, root, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 9, end: 20});
  const input = root.querySelector('wa-input.regex')!;
  input.dispatchEvent(
    new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, composed: true})
  );
  await flush(el);
  expect(tracks().range).toEqual({start: 9, end: 20});
});

test('Esc that something else handled keeps the range', async () => {
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 9, end: 20});
  const esc = new KeyboardEvent('keydown', {key: 'Escape', cancelable: true});
  esc.preventDefault();
  window.dispatchEvent(esc);
  await flush(el);
  expect(tracks().range).not.toBeNull();
});

test('the ruler and the overlay leave room for the lanes and plot scrollbars', async () => {
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 0, end: 20});
  const root = tracks().shadowRoot!;
  const lanes = root.querySelector<HTMLElement>('.lanes')!;
  const plot = root.querySelector<HTMLElement>('.plot')!;
  // No layout here: a 15px scrollbar on the lanes and a 10px one on the plot.
  Object.defineProperty(lanes, 'offsetWidth', {value: 400});
  Object.defineProperty(lanes, 'clientWidth', {value: 385});
  Object.defineProperty(plot, 'offsetWidth', {value: 265});
  Object.defineProperty(plot, 'clientWidth', {value: 255});
  (tracks() as unknown as {_width: number})._width = 255;
  tracks().requestUpdate();
  await flush(el);
  const stage = root.querySelector<HTMLElement>('.stage')!;
  expect(stage.style.getPropertyValue('--inset')).toBe('25px');
});

/** Gives the tracks a width to scale against: happy-dom has no layout. */
const sized = async (
  el: TimelineView,
  tracks: Element & {requestUpdate(): void}
) => {
  (tracks as unknown as {_width: number})._width = 385;
  tracks.requestUpdate();
  await flush(el);
};

test('the range edges are sliders the arrow keys move', async () => {
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 2, end: 8});
  await sized(el, tracks());
  const handles = () => [
    ...tracks().shadowRoot!.querySelectorAll<HTMLElement>('[role=slider]'),
  ];
  expect(handles().map((h) => h.getAttribute('aria-label'))).toEqual([
    'Range start',
    'Range end',
  ]);
  expect(handles()[0]!.getAttribute('aria-valuenow')).toBe('2');
  expect(handles()[0]!.getAttribute('aria-valuemax')).toBe('8');
  expect(handles()[1]!.getAttribute('aria-valuemin')).toBe('2');
  const press = async (i: number, key: string, shiftKey = false) => {
    handles()[i]!.dispatchEvent(
      new KeyboardEvent('keydown', {key, shiftKey, bubbles: true})
    );
    await flush(el);
  };
  // One tick step (5ms at this zoom) per press.
  await press(0, 'ArrowRight');
  expect(tracks().range).toEqual({start: 7, end: 8});
  await press(1, 'ArrowRight');
  expect(tracks().range).toEqual({start: 7, end: 11}); // the recording's end
  await press(0, 'ArrowLeft', true);
  expect(tracks().range!.start).toBe(0); // five steps, held at the start
  await press(1, 'Enter'); // not an adjustment
  expect(tracks().range).toEqual({start: 0, end: 11});
  window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  await flush(el);
  expect(tracks().range).toBeNull();
});

test('a range link waits for a span inside it, then draws and shows it', async () => {
  const {el, tracks} = await mount();
  el.location.apply({range: {start: 9, end: 20}});
  await flush(el);
  // Nothing loaded yet: held, and the link keeps reporting it.
  expect(el.location.requested('range')).toEqual({start: 9, end: 20});
  expect(tracks().range).toBeNull();
  // A buffer with nothing in the window does not satisfy it either.
  setEvents(pair(1, 0));
  await flush(el);
  expect(el.location.requested('range')).toEqual({start: 9, end: 20});
  setEvents(events);
  await flush(el);
  expect(tracks().range).toEqual({start: 9, end: 20});
  expect(el.location.requested('range')).toBeUndefined();
  expect(el.location.link().range).toEqual({start: 9, end: 20});
  expect(tracks().hidden).toBe(false);
});

test('a range link is dropped when the buffer is cleared after it', async () => {
  const {el, tracks} = await mount();
  setEvents(pair(1, 0));
  await flush(el);
  el.location.apply({range: {start: 9, end: 20}});
  await flush(el);
  expect(el.location.requested('range')).toBeDefined();
  setEvents([]); // Clear, or a new recording
  await flush(el);
  expect(el.location.requested('range')).toBeUndefined();
  setEvents(events);
  await flush(el);
  expect(tracks().range).toBeNull();
  expect(el.location.link().range).toBeUndefined();
});

test('a range the user draws supersedes one a link still holds', async () => {
  const {el, tracks} = await mount();
  el.location.apply({range: {start: 90, end: 99}});
  await flush(el);
  setEvents(events);
  await drawRange(el, tracks(), {start: 0, end: 5});
  expect(el.location.requested('range')).toBeUndefined();
  expect(tracks().range).toEqual({start: 0, end: 5});
  expect(el.location.link().range).toEqual({start: 0, end: 5});
  await drawRange(el, tracks(), null);
  expect(el.location.link().range).toBeUndefined();
});

test('Copy link puts the range link on the clipboard', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: {writeText},
    configurable: true,
  });
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 9, end: 20});
  const summary = tracks().shadowRoot!.querySelector('timeline-range-summary')!;
  summary
    .shadowRoot!.querySelector<HTMLElement>('wa-button.copy-link')!
    .click();
  await flush(el);
  const [text] = writeText.mock.calls[0] as unknown as [string];
  expect(text).toContain('#tab=timeline&range=9-20');
  expect(
    summary.shadowRoot!.querySelector('wa-button.copy-link')!.textContent
  ).toContain('Copied');
});

test('a link with a range and an event shows both', async () => {
  const {el, tracks} = await mount();
  el.location.apply({range: {start: 9, end: 20}, eventId: '2-start'});
  setEvents(events);
  await flush(el);
  expect(tracks().range).toEqual({start: 9, end: 20});
  expect(tracks().selectedKey).toBe('lit-lifecycle:2:1:update');
});

test('a click on a range handle that did not move it selects the mark beneath', async () => {
  const {el, tracks} = await mount();
  setEvents(events);
  await flush(el);
  await drawRange(el, tracks(), {start: 2, end: 8});
  await sized(el, tracks());
  const root = tracks().shadowRoot!;
  const mark = root.querySelector<HTMLElement>('.mark')!;
  const handle = root.querySelector<HTMLElement>('[role=slider]')!;
  // No layout here: say the mark is what lies under the handle.
  root.elementsFromPoint = () => [handle, mark];
  const selected = vi.fn();
  tracks().addEventListener('span-select', selected);
  const pointer = (type: string, x: number) =>
    handle.dispatchEvent(
      new PointerEvent(type, {button: 0, clientX: x, bubbles: true})
    );
  pointer('pointerdown', 10);
  pointer('pointerup', 10);
  expect(selected).toHaveBeenCalledTimes(1);
});
