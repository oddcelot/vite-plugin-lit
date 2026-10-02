import {expect, test, vi} from 'vite-plus/test';
import {LitElement, html} from 'lit';
import type {ComponentsView} from '../../panel/components-view.js';
import type {PortLike} from '../../lib/devframe/port-link.js';
import type {
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';
import {CHANNEL_PUSH_EVENT} from '../../types/timeline.js';
import type {TimelineEvent} from '../../types/timeline.js';

// The extension's whole data path with no server: a real Lit element, the
// real inspector runtime on the page end of a port, and the Lit devframe
// running in-process on the other end (`createLocalLitHost`). Then the real
// components view, handed that client through `useLocalClient`.

// The in-page channel never connects under happy-dom, and nothing here needs
// it: hover outlines are not under test.
vi.mock('devframe/in-page-channel', () => ({
  createPageScriptChannel: () => ({events: {on: () => {}}}),
}));
vi.mock('../../panel/in-page.js', () => import('./fakes/in-page.js'));

/**
 * Two linked ports. Delivery is async and JSON round-trips each message, as
 * Chrome's ports do, and anything JSON would silently drop (a function, a
 * symbol, a bigint) throws instead, so a payload only a same-realm call could
 * carry fails here rather than in the extension.
 */
const portPair = (): [PortLike, PortLike] => {
  const strict = (_key: string, value: unknown) => {
    const kind = typeof value;
    if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
      throw new TypeError(`a ${kind} cannot cross a port`);
    }
    return value;
  };
  const end = () => {
    const listeners: Array<(message: unknown) => void> = [];
    return {
      listeners,
      port: {
        postMessage(message: unknown) {
          const wire = JSON.stringify(message, strict);
          queueMicrotask(() => {
            for (const listener of other(this).listeners) {
              listener(JSON.parse(wire));
            }
          });
        },
        onMessage: {
          addListener: (cb: (m: unknown) => void) => listeners.push(cb),
        },
        onDisconnect: {addListener: () => {}},
      } as PortLike,
    };
  };
  const a = end();
  const b = end();
  const other = (port: PortLike) => (port === a.port ? b : a);
  return [a.port, b.port];
};

class LocalGreeting extends LitElement {
  static override properties = {name: {type: String}};
  declare name: string;
  constructor() {
    super();
    this.name = 'Ada';
  }
  override render() {
    return html`<p>Hello, ${this.name}</p>`;
  }
}
customElements.define('x-local-greeting', LocalGreeting);

const findTag = (
  nodes: readonly InspectorTreeNode[],
  tag: string
): InspectorTreeNode | undefined => {
  for (const node of nodes) {
    if (node.tagName === tag) return node;
    const inner = findTag(node.children, tag);
    if (inner) return inner;
  }
  return undefined;
};

test('the panel reads a live page through a port and an in-process host', async () => {
  const el = document.createElement('x-local-greeting') as LocalGreeting;
  document.body.append(el);
  await el.updateComplete;

  const [pagePort, panelPort] = portPair();
  const {createLocalLitHost, portPageTransport} =
    await import('../../lib/devframe/port-link.js');
  const {pageChannel} = await import('../../lib/runtime/page-channel.js');
  const {PAGE_ID} = await import('../../lib/runtime/page-id.js');

  // The host first: the runtime announces itself on attach.
  const client = await createLocalLitHost({port: panelPort, version: '9.9.9'});
  pageChannel.attach(portPageTransport(pagePort));
  await import('../../lib/runtime/inspector/install.js');

  const lit = client.scope('lit');
  expect((await lit.rpc.call('get-meta')).version).toBe('9.9.9');

  // Page -> host: the tree is read from the page on the call.
  const roots: InspectorTreeNode[] = await lit.rpc.call('list-components');
  const node = findTag(roots, 'x-local-greeting');
  expect(node).toBeDefined();

  const details = (await lit.rpc.call('component-details', {
    id: node!.id,
  })) as InspectorDetails;
  expect(details.tagName).toBe('x-local-greeting');
  expect(details.properties).toContainEqual(
    expect.objectContaining({name: 'name', value: '"Ada"'})
  );

  // A timeline batch the page pushes reaches a stream subscriber.
  const meta = await lit.rpc.call('get-meta');
  const reader = lit.rpc.streaming.subscribe<TimelineEvent[]>(
    meta.stream.channel,
    meta.stream.id
  );
  const event: TimelineEvent = {layerId: 'custom', time: 1, data: {n: 1}};
  pageChannel.send(CHANNEL_PUSH_EVENT, {events: [event], pageId: PAGE_ID});
  const iterator = reader[Symbol.asyncIterator]();
  const batch = (await iterator.next()).value as TimelineEvent[];
  expect(batch).toEqual([
    expect.objectContaining({...event, id: expect.any(String)}),
  ]);
  reader.cancel();

  // The real components view, on the same client.
  const {useLocalClient} = await import('../../panel/client.js');
  useLocalClient(client);
  await import('../../panel/components-view.js');
  const view = document.createElement('components-view') as ComponentsView;
  document.body.append(view);
  await vi.waitFor(() => {
    const rows = [...view.shadowRoot!.querySelectorAll('.row')];
    expect(rows.map((row) => row.textContent)).toContainEqual(
      expect.stringContaining('x-local-greeting')
    );
  });
});
