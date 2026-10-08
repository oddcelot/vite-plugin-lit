/**
 * A tag used on the page that nothing defines must show in the tree flagged
 * `notDefined`, in its real position, and stop being flagged when it is
 * defined later. Defining a tag mutates no DOM, so only the runtime's
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
