import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {TimelineEventList} from '../../panel/timeline-event-list.js';
import type {LayerState} from '../../panel/timeline-layers.js';
import {toSpans} from '../../lib/timeline/derive.js';
import type {TimelineEvent} from '../../types/timeline.js';

// The span detail asks the host whether source links can open; without a
// fake it would go looking for a real devframe server.
vi.mock('../../panel/client.js', () => import('./fakes/client.js'));

// happy-dom has no layout, so the real virtualizer never renders a row. This
// stand-in lists every item, which is all these tests read.
vi.mock('@lit-labs/virtualizer/virtualize.js', () => ({
  virtualizerRef: Symbol('virtualizerRef'),
  virtualize: ({
    items,
    renderItem,
  }: {
    items: unknown[];
    renderItem: (item: unknown) => unknown;
  }) => items.map((item) => renderItem(item)),
}));

beforeAll(async () => {
  // The virtualizer observes sizes; happy-dom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // happy-dom has no `assignedSlot`, and the virtualizer's ancestor walk
  // only stops on the `null` a browser reports for an unslotted element.
  if (!('assignedSlot' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'assignedSlot', {
      configurable: true,
      get: () => null,
    });
  }
  await import('../../panel/timeline-event-list.js');
});

/** A start/end pair for one element: one span, two raw events. */
const pair = (elementId: number, tagName: string, time: number) =>
  (['start', 'end'] as const).map((edge, i): TimelineEvent => ({
    id: `${elementId}-${edge}`,
    layerId: 'lit-lifecycle',
    time: time + i,
    data: {},
    groupId: `${elementId}:1`,
    title: `update:${edge}`,
    meta: {elementId, tagName},
  }));

const click: TimelineEvent = {
  id: 'click',
  layerId: 'mouse',
  time: 20,
  data: {},
  title: 'click',
};
const events = [...pair(1, 'x-a', 0), ...pair(2, 'x-b', 10), click];
const spans = toSpans(events);

const layer = (id: string, enabled = true): LayerState => ({
  id,
  label: id,
  color: 0,
  enabled,
});

const mount = async (props: Partial<TimelineEventList> = {}) => {
  const el = document.createElement('timeline-event-list');
  Object.assign(el, {
    events,
    spans,
    layers: [layer('lit-lifecycle'), layer('mouse')],
    ...props,
  });
  document.body.append(el);
  await el.updateComplete;
  const root = el.shadowRoot!;
  return {
    el,
    count: () => root.querySelector('.count')?.textContent?.trim(),
    raw: () => root.querySelector<HTMLElement>('.filterbar wa-switch')!,
    detail: () => root.querySelector('timeline-span-detail'),
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

test('counts visible spans against all of them', async () => {
  const {count} = await mount();
  expect(count()).toBe('3 / 3');
});

test('applies the element and regex filter', async () => {
  const {el, count} = await mount({
    filter: {elementId: 2, regex: '', range: null},
  });
  expect(count()).toBe('1 / 3');
  el.filter = {elementId: null, regex: 'click|x-a', range: null};
  await el.updateComplete;
  expect(count()).toBe('2 / 3');
});

test('an invalid regex filters nothing', async () => {
  const {count} = await mount({
    filter: {elementId: null, regex: 'foo(', range: null},
  });
  expect(count()).toBe('3 / 3');
});

test('hides the rows of a layer that is not captured', async () => {
  const {count} = await mount({
    layers: [layer('lit-lifecycle'), layer('mouse', false)],
  });
  expect(count()).toBe('2 / 3');
});

test('Raw lists every event and drops the selection', async () => {
  const {el, count, raw} = await mount({selectedKey: spans[0]!.key});
  const selected: Array<string | null> = [];
  el.addEventListener('span-select', (e) =>
    selected.push((e as CustomEvent<{key: string | null}>).detail.key)
  );
  // The switch's own handler lives on its inner input and announces `change`
  // after the switch has re-rendered.
  raw().shadowRoot!.querySelector('input')!.click();
  await new Promise((r) => setTimeout(r));
  await el.updateComplete;
  expect(count()).toBe('5 / 5');
  expect(raw().classList.contains('on')).toBe(true);
  // Raw rows and spans have different keys; the view owns clearing it.
  expect(selected).toEqual([null]);
});

test('shows the detail pane for the selected span only', async () => {
  const {el, detail} = await mount();
  expect(detail()).toBeNull();
  el.selectedKey = spans[1]!.key;
  await el.updateComplete;
  expect((detail() as unknown as {span: {key: string}} | null)?.span.key).toBe(
    spans[1]!.key
  );
  // A key from the other mode is just not here, not an error.
  el.selectedKey = 'raw:0';
  await el.updateComplete;
  expect(detail()).toBeNull();
});

test('an empty buffer shows the empty state and no filter bar', async () => {
  const {el, count} = await mount({events: [], spans: []});
  expect(count()).toBeUndefined();
  expect(el.shadowRoot!.querySelector('.empty')?.textContent).toContain(
    'No events yet'
  );
});

/** One update tick of element 1: performUpdate around update, plus a skip. */
const tickEvents = (): TimelineEvent[] => {
  const phase = (name: string, time: number) =>
    (['start', 'end'] as const).map((edge, i): TimelineEvent => ({
      id: `t-${name}-${edge}`,
      layerId: 'lit-lifecycle',
      time: time + i,
      data: {},
      groupId: '1:1',
      title: `${name}:${edge}`,
      meta: {elementId: 1, tagName: 'x-a'},
    }));
  return [
    ...phase('performUpdate', 0),
    ...phase('update', 0.2),
    {
      id: 't-skip',
      layerId: 'lit-lifecycle',
      time: 0.5,
      data: {},
      groupId: '1:1',
      title: 'update skipped',
      meta: {elementId: 1, tagName: 'x-a'},
    },
    click,
  ];
};
const tickSpans = () => toSpans(tickEvents());
const ROOT = 'lit-lifecycle:1:1:performUpdate';
const UPDATE = 'lit-lifecycle:1:1:update';

const mountTicks = (props: Partial<TimelineEventList> = {}) =>
  mount({
    events: tickEvents(),
    spans: tickSpans(),
    layers: [layer('lit-lifecycle'), layer('mouse')],
    ...props,
  });

const titles = (el: TimelineEventList) =>
  [...el.shadowRoot!.querySelectorAll('.row .title')].map((t) => t.textContent);
const twisty = (el: TimelineEventList) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('button.twisty');

test('a tick is one collapsed row with a nested count and a skip flag', async () => {
  const {el} = await mountTicks();
  expect(titles(el)).toEqual(['performUpdate', 'click']);
  const root = el.shadowRoot!.querySelector('.row')!;
  expect(root.querySelector('.nest')?.textContent).toBe('+2');
  expect(root.querySelector('.flag')?.textContent).toBe('skip');
  expect(twisty(el)?.getAttribute('aria-expanded')).toBe('false');
});

test('a collapsed tick shows the properties its update changed', async () => {
  const events = tickEvents().map((e) =>
    e.id === 't-update-start' ? {...e, data: {changed: ['count']}} : e
  );
  const {el} = await mountTicks({events, spans: toSpans(events)});
  const root = el.shadowRoot!.querySelector('.row')!;
  expect(root.querySelector('.title')?.textContent).toBe('performUpdate');
  expect(root.querySelector('.changed')?.textContent).toBe('count');
});

test('the disclosure opens and closes the tick without selecting it', async () => {
  const {el} = await mountTicks();
  const selected: Array<string | null> = [];
  el.addEventListener('span-select', (e) =>
    selected.push((e as CustomEvent<{key: string | null}>).detail.key)
  );
  twisty(el)!.click();
  await el.updateComplete;
  expect(titles(el)).toEqual([
    'performUpdate',
    'update',
    'update skipped',
    'click',
  ]);
  expect(twisty(el)?.getAttribute('aria-expanded')).toBe('true');
  twisty(el)!.dispatchEvent(
    new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true})
  );
  await el.updateComplete;
  expect(titles(el)).toEqual(['performUpdate', 'click']);
  expect(selected).toEqual([]);
});

test('selecting a nested span opens its tick', async () => {
  const {el} = await mountTicks();
  el.selectedKey = UPDATE;
  await el.updateComplete;
  expect(titles(el)).toContain('update');
  expect(
    el.shadowRoot!.querySelector('.row.selected .title')?.textContent
  ).toBe('update');
  // The reader can close it again; only a new selection reopens it.
  twisty(el)!.click();
  await el.updateComplete;
  expect(titles(el)).not.toContain('update');
});

test('closing the tick of the selected child selects the tick', async () => {
  const {el} = await mountTicks();
  const selected: Array<string | null> = [];
  el.addEventListener('span-select', (e) =>
    selected.push((e as CustomEvent<{key: string | null}>).detail.key)
  );
  el.selectedKey = UPDATE;
  await el.updateComplete;
  twisty(el)!.click();
  await el.updateComplete;
  expect(selected).toEqual([ROOT]);
});

test('a filter that matches only a child keeps its parent', async () => {
  const {el, count} = await mountTicks({
    filter: {elementId: null, regex: '^x-a update\\s*$', range: null},
  });
  expect(count()).toBe('1 / 4');
  expect(titles(el)).toEqual(['performUpdate']);
  expect(el.shadowRoot!.querySelector('.nest')?.textContent).toBe('+1');
});

test('Expand all and Collapse all toggle every tick', async () => {
  const {el} = await mountTicks();
  const all = () =>
    el.shadowRoot!.querySelector<HTMLButtonElement>('.expand-all')!;
  expect(all().textContent?.trim()).toBe('Expand all');
  all().click();
  await el.updateComplete;
  expect(titles(el)).toHaveLength(4);
  expect(all().textContent?.trim()).toBe('Collapse all');
  all().click();
  await el.updateComplete;
  expect(titles(el)).toHaveLength(2);
});

test('Raw stays flat', async () => {
  const {el, raw} = await mountTicks();
  raw().shadowRoot!.querySelector('input')!.click();
  await new Promise((r) => setTimeout(r));
  await el.updateComplete;
  expect(titles(el)).toHaveLength(tickEvents().length);
  expect(twisty(el)).toBeNull();
});

/** A tick of one element: performUpdate around update, as raw events. */
const tick = (
  elementId: number,
  time: number,
  cause?: TimelineEvent['cause']
): TimelineEvent[] =>
  (['performUpdate', 'update'] as const).flatMap((name, n) =>
    (['start', 'end'] as const).map((edge, i): TimelineEvent => ({
      id: `c${elementId}-${name}-${edge}`,
      layerId: 'lit-lifecycle',
      time: time + n * 0.2 + i * (name === 'update' ? 0.1 : 1),
      data: {},
      groupId: `${elementId}:1`,
      title: `${name}:${edge}`,
      meta: {elementId, tagName: `x-${elementId}`},
      ...(cause && name === 'performUpdate' && edge === 'start' ? {cause} : {}),
    }))
  );

const chainEvents = (): TimelineEvent[] => [
  ...tick(1, 0),
  ...tick(2, 0.5, {kind: 'update', groupId: '1:1'}),
];
const PARENT = 'lit-lifecycle:1:1:performUpdate';
const CHILD = 'lit-lifecycle:2:1:performUpdate';

const mountChain = (props: Partial<TimelineEventList> = {}) =>
  mount({
    events: chainEvents(),
    spans: toSpans(chainEvents()),
    layers: [layer('lit-lifecycle'), layer('mouse')],
    ...props,
  });

/**
 * A click, a lone timer tick, the tick the click caused, and a tick that one
 * caused in turn: three rows in one chain with an unrelated row inside it.
 */
const graphEvents = (): TimelineEvent[] => [
  {...click, time: 5},
  ...tick(3, 5.5),
  ...tick(1, 6, {kind: 'event', layerId: 'mouse', time: 5}),
  ...tick(2, 7, {kind: 'update', groupId: '1:1'}),
];

const mountGraph = (props: Partial<TimelineEventList> = {}) =>
  mount({
    events: graphEvents(),
    spans: toSpans(graphEvents()),
    layers: [layer('lit-lifecycle'), layer('mouse')],
    ...props,
  });

const rows = (el: TimelineEventList) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>('.row'),
];

test('cause chains stay in time order with a rail on every row', async () => {
  const {el} = await mountGraph();
  expect(titles(el)).toEqual([
    'click',
    'performUpdate',
    'performUpdate',
    'performUpdate',
  ]);
  expect(rows(el).every((r) => r.querySelector('.rail') !== null)).toBe(true);
  // No row nests under another: the twisty folds only a tick's phases.
  expect(el.shadowRoot!.querySelectorAll('.row.nested')).toHaveLength(0);
  const [clickRow, lone, caused, child] = rows(el);
  // The click is the chain's root: a dot in lane 0, its line going down.
  const clickDot = clickRow!.querySelector<HTMLElement>('.rail .dot')!;
  expect(clickDot.style.left).toBe('calc(0px + 8px)');
  const down = [...clickRow!.querySelectorAll('.rail svg line')];
  expect(down).toHaveLength(1);
  expect(down[0]!.getAttribute('y1')).toBe('8');
  expect(down[0]!.getAttribute('y2')).toBe('16');
  // The timer tick is not in the chain; the line passes it by.
  expect(lone!.querySelector('.rail .dot')).toBeNull();
  const through = [...lone!.querySelectorAll('.rail svg line')];
  expect(through).toHaveLength(1);
  expect(through[0]!.getAttribute('y1')).toBe('0');
  expect(through[0]!.getAttribute('y2')).toBe('16');
  // The caused tick continues the lane and carries on to its own child.
  expect(caused!.querySelector('.rail .dot')).not.toBeNull();
  expect(caused!.querySelectorAll('.rail svg line')).toHaveLength(2);
  expect(child!.querySelector('.rail .dot')).not.toBeNull();
  expect(child!.querySelectorAll('.rail svg line')).toHaveLength(1);
  expect(child!.querySelector('.rail svg path')).toBeNull();
  expect(clickRow!.querySelector('.rail')!.getAttribute('aria-hidden')).toBe(
    'true'
  );
});

test('hovering a row of a chain dims the rails of rows outside it', async () => {
  const {el} = await mountGraph();
  rows(el)[0]!.dispatchEvent(new MouseEvent('mouseenter'));
  await el.updateComplete;
  const dim = rows(el).map((r) =>
    r.querySelector('.rail')!.classList.contains('dim')
  );
  expect(dim).toEqual([false, true, false, false]);
  el.shadowRoot!.querySelector('.scroll')!.dispatchEvent(
    new MouseEvent('mouseleave')
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('.rail.dim')).toBeNull();
});

test('Raw draws no rails', async () => {
  const {el, raw} = await mountGraph();
  raw().shadowRoot!.querySelector('input')!.click();
  await new Promise((r) => setTimeout(r));
  await el.updateComplete;
  expect(rows(el).length).toBeGreaterThan(0);
  expect(el.shadowRoot!.querySelector('.rail')).toBeNull();
});

test("the detail pane's show link selects the click that caused a tick", async () => {
  const graphSpans = toSpans(graphEvents());
  const clickKey = graphSpans.find((s) => s.name === 'click')!.key;
  const {el, detail} = await mountGraph({
    selectedKey: 'lit-lifecycle:1:1:performUpdate',
  });
  const selected: Array<string | null> = [];
  el.addEventListener('span-select', (e) =>
    selected.push((e as CustomEvent<{key: string | null}>).detail.key)
  );
  detail()!.dispatchEvent(
    new CustomEvent('span-jump', {detail: {}, bubbles: true, composed: true})
  );
  expect(selected).toEqual([clickKey]);
});

test("the detail pane's show link selects the parent row", async () => {
  const {el, detail} = await mountChain({selectedKey: CHILD});
  const selected: Array<string | null> = [];
  el.addEventListener('span-select', (e) =>
    selected.push((e as CustomEvent<{key: string | null}>).detail.key)
  );
  detail()!.dispatchEvent(
    new CustomEvent('span-jump', {detail: {}, bubbles: true, composed: true})
  );
  expect(selected).toEqual([PARENT]);
});

test('warning and error point rows are marked, plain rows are not', async () => {
  const point = (
    id: string,
    time: number,
    logType?: 'warning' | 'error'
  ): TimelineEvent => ({
    id,
    layerId: 'lit-warnings',
    time,
    data: {phase: 'warning', code: 'dev-mode', message: 'dev mode'},
    title: 'warning:dev-mode',
    logType,
  });
  const evs = [point('w', 1, 'warning'), point('e', 2, 'error'), point('p', 3)];
  const {el} = await mount({
    events: evs,
    spans: toSpans(evs),
    layers: [layer('lit-warnings')],
  });
  const rows = [...el.shadowRoot!.querySelectorAll('.row')];
  expect(rows.map((r) => r.classList.contains('warning'))).toEqual([
    true,
    false,
    false,
  ]);
  expect(rows[1]!.classList.contains('error')).toBe(true);
  expect(rows.map((r) => r.querySelector('.mark') !== null)).toEqual([
    true,
    true,
    false,
  ]);
});
