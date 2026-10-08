/**
 * The Components details snapshot describes an element's slots and parts,
 * and the anatomy overlay draws them on the page. Worth an e2e because slot
 * assignment, forwarding and layout only behave for real in a real browser.
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  type InspectorDetails,
  type InspectorMessage,
  type InspectorTreeNode,
} from '../../types/inspector.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;
let roots: InspectorTreeNode[] = [];
const details: InspectorDetails[] = [];

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
  fixture.server.hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
    if (data.type === 'tree') roots = data.roots;
    if (data.type === 'details') details.push(data.details);
  });
});

afterAll(async () => {
  await fixture?.close();
});

const find = (
  nodes: InspectorTreeNode[],
  tag: string
): InspectorTreeNode | undefined => {
  for (const node of nodes) {
    if (node.tagName === tag) return node;
    const found = find(node.children, tag);
    if (found !== undefined) return found;
  }
  return undefined;
};

const nodeFor = async (tag: string): Promise<InspectorTreeNode> => {
  await expect
    .poll(
      () => {
        fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'tree'});
        return find(roots, tag);
      },
      {timeout: 10_000}
    )
    .toBeDefined();
  return find(roots, tag)!;
};

const detailsFor = async (id: number): Promise<InspectorDetails> => {
  await expect
    .poll(
      () => {
        fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'details', id});
        return details.find((d) => d.id === id);
      },
      {timeout: 10_000}
    )
    .toBeDefined();
  return details.find((d) => d.id === id)!;
};

test('describes slots, orphans and parts of a real component', async () => {
  const {id} = await nodeFor('hmr-slots');
  const {anatomy} = await detailsFor(id);
  expect(anatomy).toMatchObject({
    renderRoot: 'shadow',
    mode: 'open',
    delegatesFocus: false,
    slots: [
      {name: 'icon', status: 'empty'},
      {name: 'title', status: 'assigned', elements: [{tagName: 'strong'}]},
      {name: '', status: 'assigned', elements: [{tagName: 'p'}]},
      {name: 'footer', status: 'fallback'},
    ],
    orphans: [{tagName: 'em', slot: 'aside'}],
    parts: [
      {names: ['header'], tagName: 'header'},
      {names: ['body'], tagName: 'div'},
    ],
  });
});

test('marks content forwarded through an enclosing slot', async () => {
  const frame = await nodeFor('hmr-slots-frame');
  const card = find(frame.children, 'hmr-slots')!;
  const {anatomy} = await detailsFor(card.id);
  expect(anatomy?.slots[2]).toMatchObject({
    name: '',
    status: 'assigned',
    forwarded: true,
    elements: [{tagName: 'p'}],
  });
});

test('lists parts forwarded by a nested component with exportparts', async () => {
  const frame = await nodeFor('hmr-slots-frame');
  const {anatomy} = await detailsFor(frame.id);
  expect(anatomy?.parts).toEqual([
    {names: ['header'], tagName: 'header', forwarded: {from: 'hmr-slots'}},
    {
      names: ['card-body'],
      tagName: 'div',
      forwarded: {from: 'hmr-slots', inner: 'body'},
    },
  ]);
});

test('refreshes a watched element when a light child changes slot', async () => {
  const {id} = await nodeFor('hmr-slots');
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'watch', id});
  const latest = () =>
    details.filter((d) => d.id === id).at(-1)?.anatomy?.slots;
  await expect.poll(latest, {timeout: 10_000}).toBeDefined();

  // No re-render happens: only the child's `slot` attribute changes.
  await fixture.page.evaluate(
    `document.querySelector('hmr-slots > p').setAttribute('slot', 'icon')`
  );
  await expect
    .poll(() => latest()?.[0].status, {timeout: 10_000})
    .toBe('assigned');

  await fixture.page.evaluate(
    `document.querySelector('hmr-slots > p').removeAttribute('slot')`
  );
  await expect
    .poll(() => latest()?.[0].status, {timeout: 10_000})
    .toBe('empty');
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'watch', id: null});
});

test('draws labelled slot and part regions until cleared', async () => {
  const {id} = await nodeFor('hmr-slots');
  await fixture.page.evaluate(
    `document.querySelector('hmr-slots').scrollIntoView({block: 'center'})`
  );
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'anatomy', id});

  const labels = `Array.from(
    document.querySelectorAll('[data-lit-devtools-anatomy] > div'),
    (box) => box.style.display === 'none' ? null : box.textContent
  ).filter(Boolean)`;
  await expect
    .poll(() => fixture.page.evaluate(labels), {timeout: 10_000})
    .toEqual([
      '<hmr-slots>',
      'slot "title"',
      'default slot',
      'slot "footer" · fallback',
      '::part(header)',
      '::part(body)',
    ]);
  if (process.env['ANATOMY_SHOT']) {
    const box = (await fixture.page
      .locator('hmr-slots')
      .first()
      .boundingBox())!;
    await fixture.page.screenshot({
      path: process.env['ANATOMY_SHOT'],
      clip: {
        x: box.x - 24,
        y: box.y - 40,
        width: box.width + 48,
        height: box.height + 64,
      },
    });
  }

  // Focus the title slot: it gains a ring, everything else fades.
  const regions = `Array.from(
    document.querySelectorAll('[data-lit-devtools-anatomy] > div'),
    (box) => [box.textContent, box.style.opacity, box.style.boxShadow !== 'none']
  )`;
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'anatomy-focus',
    focus: {kind: 'slot', index: 1},
  });
  await expect
    .poll(() => fixture.page.evaluate(regions), {timeout: 10_000})
    .toEqual([
      ['<hmr-slots>', '0.25', false],
      ['slot "title"', '1', true],
      ['default slot', '0.25', false],
      ['slot "footer" · fallback', '0.25', false],
      ['::part(header)', '0.25', false],
      ['::part(body)', '0.25', false],
    ]);
  if (process.env['ANATOMY_SHOT']) {
    const box = (await fixture.page
      .locator('hmr-slots')
      .first()
      .boundingBox())!;
    await fixture.page.screenshot({
      path: process.env['ANATOMY_SHOT'].replace('.png', '-focus.png'),
      clip: {
        x: box.x - 24,
        y: box.y - 40,
        width: box.width + 48,
        height: box.height + 64,
      },
    });
  }
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'anatomy-focus',
    focus: null,
  });
  await expect
    .poll(
      async () =>
        ((await fixture.page.evaluate(regions)) as unknown[][]).every(
          ([, opacity, ring]) => opacity === '1' && ring === false
        ),
      {timeout: 10_000}
    )
    .toBe(true);

  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'anatomy', id: null});
  await expect
    .poll(
      () =>
        fixture.page.evaluate(
          `document.querySelector('[data-lit-devtools-anatomy]') === null`
        ),
      {timeout: 10_000}
    )
    .toBe(true);
});
