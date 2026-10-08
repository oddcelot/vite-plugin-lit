/**
 * Lit's dev build warns about component mistakes through a module-private
 * function that records into `globalThis.litIssuedWarnings`. Only a real Lit
 * in a real page shows that the runtime hooks that Set early enough, replays
 * what it missed, and attributes a warning to the element that caused it.
 */

import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {TimelineChannelCodec} from '../../lib/devframe/page-codec.js';
import {fromViteHot} from '../../lib/runtime/page-transport.js';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  type InspectorDetails,
  type InspectorMessage,
  type InspectorTreeNode,
} from '../../types/inspector.js';
import type {TimelineEvent} from '../../types/timeline.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;
let roots: InspectorTreeNode[] = [];
const details: InspectorDetails[] = [];
const events: TimelineEvent[] = [];
let source: TimelineChannelCodec;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
  fixture.server.hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
    if (data.type === 'tree') roots = data.roots;
    if (data.type === 'details') details.push(data.details);
  });
  source = new TimelineChannelCodec();
  source.connect(fromViteHot(fixture.server.hot));
  source.attach({
    pushEvents: (batch) => events.push(...batch),
    addLayer: () => {},
    inspectorMessage: () => {},
    hmrIncompatible: () => {},
    hmrPatched: () => {},
    runtimeReady: () => {},
  });
  await fixture.page.reload();
  await fixture.page.waitForFunction(
    () => (window as {__hmr?: unknown}).__hmr !== undefined
  );
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

/** A component that schedules another update from inside `updated`. */
const defineChurner = (tag: string): Promise<void> =>
  fixture.page.evaluate(`(() => {
    const Base = Object.getPrototypeOf(customElements.get('hmr-task'));
    class Churner extends Base {
      updated() {
        if (!this.nudged) {
          this.nudged = true;
          this.requestUpdate();
        }
      }
    }
    customElements.define(${JSON.stringify(tag)}, Churner);
    document.body.append(document.createElement(${JSON.stringify(tag)}));
  })()`) as Promise<void>;

test('a change-in-update warning is badged on its element and replayed into a recording', async () => {
  await defineChurner('e2e-churn-early');

  // The component's own tag is in Lit's message, so the details know it.
  await expect
    .poll(
      () => {
        fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'tree'});
        const id = find(roots, 'e2e-churn-early');
        if (id === undefined) return undefined;
        fixture.server.hot.send(INSPECT_CMD_CHANNEL, {type: 'details', id});
        return details.filter((d) => d.id === id).at(-1)?.warnings;
      },
      {timeout: 10_000}
    )
    .toEqual([
      expect.objectContaining({
        code: 'change-in-update',
        message: expect.stringContaining('e2e-churn-early'),
      }),
    ]);

  // Issued before anything recorded: it arrives as a replay.
  source.setRecording(true);
  await expect
    .poll(() => events.find((e) => e.title === 'warning:change-in-update'), {
      timeout: 10_000,
    })
    .toMatchObject({
      layerId: 'lit-lifecycle',
      logType: 'warning',
      subtitle: 'e2e-churn-early',
      data: {code: 'change-in-update', replayed: true},
      meta: {tagName: 'e2e-churn-early'},
    });
});

test('a warning issued while recording is attributed to the updating element', async () => {
  source.setRecording(true);
  await defineChurner('e2e-churn-live');

  await expect
    .poll(
      () =>
        events.find(
          (e) =>
            e.title === 'warning:change-in-update' &&
            e.subtitle === 'e2e-churn-live'
        ),
      {timeout: 10_000}
    )
    .toMatchObject({
      logType: 'warning',
      data: {code: 'change-in-update', message: expect.any(String)},
      meta: {tagName: 'e2e-churn-live', elementId: expect.any(Number)},
    });
  const live = events.find((e) => e.subtitle === 'e2e-churn-live');
  expect((live?.data as {replayed?: boolean}).replayed).toBeUndefined();
});
