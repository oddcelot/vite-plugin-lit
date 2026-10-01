import {afterEach, beforeAll, expect, test} from 'vite-plus/test';
import type {TimelineEventList} from '../../panel/timeline-event-list.js';
import type {LayerState} from '../../panel/timeline-layers.js';
import {toSpans} from '../../lib/timeline/derive.js';
import type {TimelineEvent} from '../../types/timeline.js';

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
    raw: () => root.querySelector<HTMLButtonElement>('.filterbar button')!,
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
  const {el, count} = await mount({filter: {elementId: 2, regex: ''}});
  expect(count()).toBe('1 / 3');
  el.filter = {elementId: null, regex: 'click|x-a'};
  await el.updateComplete;
  expect(count()).toBe('2 / 3');
});

test('an invalid regex filters nothing', async () => {
  const {count} = await mount({filter: {elementId: null, regex: 'foo('}});
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
  raw().click();
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
    'No events recorded.'
  );
});
