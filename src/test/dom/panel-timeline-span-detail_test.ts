import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {TimelineSpan} from '../../lib/timeline/derive.js';

const opened = vi.hoisted(() => vi.fn());
vi.mock('../../panel/open-in-editor.js', () => ({openInEditor: opened}));

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

const mount = async (props: {span?: TimelineSpan; filterable?: boolean}) => {
  const el = document.createElement('timeline-span-detail');
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  const root = el.shadowRoot!;
  const value = (key: string) =>
    [...root.querySelectorAll('tr')]
      .find((tr) => tr.querySelector('.key')?.textContent === key)
      ?.querySelector('.val')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
  const link = (text: string) =>
    [...root.querySelectorAll<HTMLElement>('wa-button')].find(
      (a) => a.textContent?.trim() === text
    );
  return {el, root, value, link};
};

afterEach(() => {
  document.body.replaceChildren();
  opened.mockClear();
});

test('renders nothing without a span', async () => {
  const {root} = await mount({});
  expect(root.querySelector('table')).toBeNull();
});

test('shows the span as a table of facts', async () => {
  const {value} = await mount({span});
  expect(value('layer')).toBe('lit-lifecycle');
  expect(value('time')).toBe('1.500 ms');
  expect(value('duration')).toBe('1.500 ms');
  expect(value('changed')).toBe('count, label');
  expect(value('element')).toContain('<x-counter> #7');
  expect(value('data')).toBe('{"phase":"update"}');
});

test('leaves out what the span does not have', async () => {
  const {value} = await mount({
    span: {...span, duration: undefined, changed: undefined, meta: undefined},
  });
  expect(value('duration')).toBeUndefined();
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
  const {value} = await mount({
    span: {
      ...span,
      changedDetail: [
        {key: 'count', prev: '0', next: '1', sameRef: false, equal: false},
        {key: 'items', prev: '[1]', next: '[1]', sameRef: false, equal: true},
      ],
    },
  });
  expect(value('values')).toBe(
    'count: 0 → 1 items: [1] → [1]new reference, same value'
  );
});

test('has no values row without detail', async () => {
  const {value} = await mount({span});
  expect(value('values')).toBeUndefined();
});
