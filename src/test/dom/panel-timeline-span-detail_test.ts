import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {TimelineSpan} from '../../lib/timeline/derive.js';

const opened = vi.hoisted(() => vi.fn());
const editor = vi.hoisted(() => ({available: true}));
vi.mock('../../panel/open-in-editor.js', () => ({
  openInEditor: opened,
  canOpenInEditor: async () => editor.available,
}));

beforeAll(async () => {
  await import('../../panel/timeline-span-detail.js');
});

const span: TimelineSpan = {
  layerId: 'lit-lifecycle',
  key: 'k',
  name: 'update',
  start: 1.5,
  end: 3,
  duration: 1.5,
  changed: ['count', 'label'],
  meta: {
    elementId: 7,
    tagName: 'x-counter',
    source: {file: 'src/counter.ts', line: 12},
  },
  events: [{layerId: 'lit-lifecycle', time: 1.5, data: {phase: 'update'}}],
};

const mount = async (props: {
  span?: TimelineSpan;
  filterable?: boolean;
  layers?: {id: string; label: string; color: number; enabled: boolean}[];
}) => {
  const el = document.createElement('timeline-span-detail');
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  // `canOpenInEditor()` settles a microtask later.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  const root = el.shadowRoot!;
  const text = (sel: string) =>
    root.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const value = (key: string) => text(`.val[data-key="${key}"]`);
  const link = (text: string) =>
    [...root.querySelectorAll<HTMLElement>('wa-button')].find(
      (a) => a.textContent?.trim() === text
    );
  return {el, root, text, value, link};
};

afterEach(() => {
  document.body.replaceChildren();
  opened.mockClear();
  editor.available = true;
});

test('renders nothing without a span', async () => {
  const {root} = await mount({});
  expect(root.querySelector('header')).toBeNull();
});

test('heads the pane with the span name, layer, time and duration', async () => {
  const {text} = await mount({
    span,
    layers: [
      {id: 'lit-lifecycle', label: 'Lifecycle', color: 0x00ff00, enabled: true},
    ],
  });
  expect(text('.name')).toBe('update');
  expect(text('.layer')).toBe('Lifecycle');
  expect(text('.time')).toBe('at 1.500 ms');
  expect(text('.duration')).toBe('took 1.5ms');
});

test('lists the facts the span has', async () => {
  const {value, text, root} = await mount({span});
  expect(text('.layer')).toBe('lit-lifecycle');
  const chips = root.querySelectorAll('.val[data-key="changed"] .chip');
  expect([...chips].map((c) => c.textContent)).toEqual(['count', 'label']);
  expect(value('element')).toContain('<x-counter> #7');
  expect(JSON.parse(value('data')!)).toEqual({phase: 'update'});
});

test('leaves out what the span does not have', async () => {
  const {value, text} = await mount({
    span: {...span, duration: undefined, changed: undefined, meta: undefined},
  });
  expect(text('.duration')).toBeUndefined();
  expect(value('changed')).toBeUndefined();
  expect(value('element')).toBeUndefined();
  expect(value('source')).toBeUndefined();
});

test('filter appears only where there is a filter to set', async () => {
  expect((await mount({span})).link('filter')).toBeUndefined();
  const {el, link} = await mount({span, filterable: true});
  const ids: number[] = [];
  el.addEventListener('element-filter', (e) =>
    ids.push((e as CustomEvent<{id: number}>).detail.id)
  );
  link('filter')!.click();
  expect(ids).toEqual([7]);
});

test('inspect asks the shell for the Components tab', async () => {
  const {link} = await mount({span});
  const ids: number[] = [];
  document.body.addEventListener('inspect-element', (e) =>
    ids.push((e as CustomEvent<{id: number}>).detail.id)
  );
  link('inspect')!.click();
  expect(ids).toEqual([7]);
});

test('the source link opens the file at its line', async () => {
  const {root} = await mount({span});
  root.querySelector<HTMLElement>('.src-link')!.click();
  expect(opened).toHaveBeenCalledWith('src/counter.ts', 12);
});

test('lists old and new values when the span has them', async () => {
  const {value, root} = await mount({
    span: {
      ...span,
      changedDetail: [
        {key: 'count', prev: '0', next: '1', sameRef: false, equal: false},
        {key: 'items', prev: '[1]', next: '[1]', sameRef: false, equal: true},
      ],
    },
  });
  expect(value('values')).toBe(
    'count 0 1 items [1] [1] new reference, same value'
  );
  // An icon, not a text glyph, sits between each prev and next.
  const arrows = root.querySelectorAll('wa-icon.arrow[name="arrow-right"]');
  expect(arrows).toHaveLength(2);
  const cells = [...root.querySelectorAll('.values > *')].map((c) =>
    c.localName === 'wa-icon' ? '→' : c.textContent!.trim()
  );
  expect(cells).toEqual([
    'count',
    '0',
    '→',
    '1',
    '',
    'items',
    '[1]',
    '→',
    '[1]',
    'new reference, same value',
  ]);
});

test('has no values row without detail', async () => {
  const {value} = await mount({span});
  expect(value('values')).toBeUndefined();
});

test('shows the source as plain text where the host has no editor', async () => {
  editor.available = false;
  const {value, link} = await mount({span});
  expect(value('source')).toBe('src/counter.ts:12');
  expect(link('src/counter.ts:12')).toBeUndefined();
});

const withSite: TimelineSpan = {
  ...span,
  meta: {...span.meta, callSite: {file: 'src/app.ts', line: 30, column: 5}},
};

test('the rendered-at link opens the call site at its column', async () => {
  const {root, value} = await mount({span: withSite});
  expect(value('rendered at')).toBe('src/app.ts:30');
  root.querySelector<HTMLElement>('.src-link.call-site')!.click();
  expect(opened).toHaveBeenCalledWith('src/app.ts', 30, 5);
});

test('shows the call site as plain text where the host has no editor', async () => {
  editor.available = false;
  const {value, root} = await mount({span: withSite});
  expect(value('rendered at')).toBe('src/app.ts:30');
  expect(root.querySelector('.call-site')).toBeNull();
});

test('has no rendered-at row for an element without a call site', async () => {
  const {value} = await mount({span});
  expect(value('rendered at')).toBeUndefined();
});

test('names the cause and jumps to it', async () => {
  const {value, link, el} = await mount({
    span: {...span, cause: {kind: 'update', groupId: '3:1'}},
  });
  expect(value('caused by')).toContain('update 3:1');
  const jumps: unknown[] = [];
  el.addEventListener('span-jump', (e) =>
    jumps.push((e as CustomEvent).detail)
  );
  link('show')!.click();
  expect(jumps).toEqual([{cause: {kind: 'update', groupId: '3:1'}}]);
});

test('names an event cause by layer and time', async () => {
  const {value} = await mount({
    span: {...span, cause: {kind: 'event', layerId: 'mouse', time: 5}},
  });
  expect(value('caused by')).toContain('mouse event at 5.000 ms');
});

test('has no caused by row without a cause', async () => {
  expect((await mount({span})).value('caused by')).toBeUndefined();
});

test('shows the error the span recorded', async () => {
  const {value} = await mount({
    span: {...span, error: {name: 'TypeError', message: 'boom', async: true}},
  });
  expect(value('error')).toBe('TypeError: boom (async)');
});

test('the handle resizes the pane and remembers the height', async () => {
  localStorage.removeItem('lit-devtools-timeline-detail-height');
  const {el, root} = await mount({span});
  const handle = root.querySelector<HTMLElement>('.handle')!;
  expect(el.style.getPropertyValue('--detail-height')).toBe('200px');
  handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp'}));
  await el.updateComplete;
  expect(el.style.getPropertyValue('--detail-height')).toBe('216px');
  expect(localStorage.getItem('lit-devtools-timeline-detail-height')).toBe(
    '216'
  );
  handle.dispatchEvent(new MouseEvent('dblclick'));
  await el.updateComplete;
  expect(el.style.getPropertyValue('--detail-height')).toBe('200px');
});
