/**
 * A tag used on the page that nothing defines must show in the tree flagged
 * `notDefined`, in its real position, and stop being flagged when it is
 * defined later; a custom element another library defines shows flagged
 * `notLit`. Defining a tag mutates no DOM, so only the runtime's
 * `customElements.whenDefined` wait can refresh a live tree; that and the
 * browser's own `:not(:defined)` are why this runs against a real page.
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
let details: InspectorDetails | undefined;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
  fixture.server.hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
    if (data.type === 'tree') roots = data.roots;
    if (data.type === 'details') details = data.details;
  });
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'observe',
    enabled: true,
  });
});

afterAll(async () => {
  fixture?.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'observe',
    enabled: false,
  });
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

test('lists an undefined tag, then drops the flag once it is defined', async () => {
  const tag = 'e2e-undefined-thing';
  await fixture.page.evaluate(`(() => {
    const el = document.createElement('${tag}');
    el.setAttribute('data-lit-source', 'src/app.ts:7:3');
    document.body.append(el);
  })()`);

  await expect
    .poll(() => find(roots, tag), {timeout: 5_000})
    .toMatchObject({
      notDefined: true,
      callSite: {file: 'src/app.ts', line: 7, column: 3},
    });

  details = undefined;
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'details',
    id: find(roots, tag)!.id,
  });
  await expect
    .poll(() => details, {timeout: 5_000})
    .toMatchObject({
      tagName: tag,
      notDefined: true,
      properties: [],
    });

  // No DOM change: only the define itself can refresh the live tree.
  await fixture.page.evaluate(
    `customElements.define('${tag}', class extends HTMLElement { requestUpdate() {} })`
  );
  await expect
    .poll(() => find(roots, tag), {timeout: 5_000})
    .not.toHaveProperty('notDefined');
});

test('lists a non-Lit custom element in place, including one defined late', async () => {
  const outer = 'e2e-plain-outer';
  const late = 'e2e-plain-late';
  // A vanilla element wrapping a Lit one, and a tag defined only afterwards.
  await fixture.page.evaluate(`(() => {
    customElements.define('${outer}', class extends HTMLElement {
      constructor() { super(); this.attachShadow({mode: 'open'}); }
    });
    const el = document.createElement('${outer}');
    el.setAttribute('variant', 'brand');
    el.shadowRoot.append(document.createElement('hmr-counter'));
    document.body.append(el, document.createElement('${late}'));
  })()`);

  await expect
    .poll(() => find(roots, outer), {timeout: 5_000})
    .toMatchObject({
      notLit: true,
      children: [expect.objectContaining({tagName: 'hmr-counter'})],
    });
  expect(find(roots, outer)!.children[0]).not.toHaveProperty('notLit');
  expect(find(roots, late)).toMatchObject({notDefined: true});

  details = undefined;
  fixture.server.hot.send(INSPECT_CMD_CHANNEL, {
    type: 'details',
    id: find(roots, outer)!.id,
  });
  await expect
    .poll(() => details, {timeout: 5_000})
    .toMatchObject({
      tagName: outer,
      notLit: true,
      attributes: [{name: 'variant', value: 'brand'}],
      properties: [],
    });

  await fixture.page.evaluate(
    `customElements.define('${late}', class extends HTMLElement {})`
  );
  await expect
    .poll(() => find(roots, late), {timeout: 5_000})
    .toMatchObject({notLit: true});
  expect(find(roots, late)).not.toHaveProperty('notDefined');
});
