/**
 * The Components details snapshot lists non-reactive instance state. Worth an
 * e2e because the shapes it duck-types (a `@lit/task` controller held in a
 * private field, Lit's private controller set) only exist on real components
 * built by the real Lit in a real page.
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

const find = (nodes: InspectorTreeNode[], tag: string): number | undefined => {
  for (const node of nodes) {
    if (node.tagName === tag) return node.id;
    const found = find(node.children, tag);
    if (found !== undefined) return found;
  }
  return undefined;
};

test('lists a real @lit/task by its field name with its status and value', async () => {
  // Let the fake fetch settle, so the task is complete when it is read.
  await expect
    .poll(
      () =>
        fixture.page.evaluate(
          `document.querySelector('hmr-task')?.shadowRoot?.querySelector('#user')?.textContent ?? ''`
        ),
      {timeout: 10_000}
    )
    .toContain('Ada Lovelace');

  await expect
    .poll(
      () => {
        fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'tree'});
        return find(roots, 'hmr-task');
      },
      {timeout: 10_000}
    )
    .toBeDefined();
  const id = find(roots, 'hmr-task')!;

  await expect
    .poll(
      () => {
        fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'details', id});
        return details.find((d) => d.id === id)?.extras;
      },
      {timeout: 10_000}
    )
    .toContainEqual(
      expect.objectContaining({
        kind: 'task',
        name: 'userTask',
        type: 'Task',
        status: 'complete',
      })
    );
});
