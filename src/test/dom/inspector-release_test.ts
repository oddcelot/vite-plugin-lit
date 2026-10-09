import {afterEach, expect, test, vi} from 'vite-plus/test';
import {
  ELEMENT_BY_ID_KEY,
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
} from '../../types/inspector.js';

// The real in-page channel never connects under happy-dom; this lets a test
// play "the panel connected / disconnected". install.ts only uses `events.on`.
const fake = vi.hoisted(() => ({
  listeners: new Map<string, Array<(peer: {id: string}) => void>>(),
}));
vi.mock('devframe/in-page-channel', () => ({
  createPageScriptChannel: () => ({
    events: {
      on: (name: string, fn: (peer: {id: string}) => void) => {
        const list = fake.listeners.get(name) ?? [];
        list.push(fn);
        fake.listeners.set(name, list);
      },
    },
  }),
}));

const fire = (name: string, id: string) => {
  for (const fn of fake.listeners.get(name) ?? []) fn({id});
};

// A carrier that records what it is asked to do and lets a test play the peer.
const fakeCarrier = () => {
  const sent: Array<[string, unknown]> = [];
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    sent,
    send: (channel: string, data?: unknown) => void sent.push([channel, data]),
    on(channel: string, handler: (data: unknown) => void) {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
      return () => void set.delete(handler);
    },
    deliver(channel: string, data: unknown) {
      for (const handler of handlers.get(channel) ?? []) handler(data);
    },
  };
};
type Carrier = ReturnType<typeof fakeCarrier>;

const count = (carrier: Carrier, type: string) =>
  carrier.sent.filter(
    ([ch, m]) =>
      ch === INSPECT_DATA_CHANNEL && (m as {type: string}).type === type
  ).length;
const trees = (carrier: Carrier) => count(carrier, 'tree');
const readies = (carrier: Carrier) => count(carrier, 'ready');

// Fresh runtime per test: the channel lives on globalThis, and install.ts
// keeps its watch/observer state in module scope.
const load = async () => {
  vi.resetModules();
  const g = globalThis as unknown as Record<symbol, unknown>;
  delete g[Symbol.for('@oddsquad/vite-plugin-lit#page-channel')];
  fake.listeners.clear();
  const {pageChannel} = await import('../../lib/runtime/page-channel.js');
  const carrier = fakeCarrier();
  // Attach before importing install.js so its listeners bind immediately.
  pageChannel.attach(carrier);
  await import('../../lib/runtime/inspector/install.js');
  const {idOf} = await import('../../lib/runtime/timeline/identity.js');
  return {carrier, idOf};
};

let n = 0;
const make = () => {
  const tag = `x-release-${n++}`;
  customElements.define(
    tag,
    class extends HTMLElement {
      requestUpdate() {}
    }
  );
  return document.createElement(tag);
};

// The runtime debounces tree pushes by 100 ms.
const settle = () => new Promise((r) => setTimeout(r, 250));

const hasOwnUpdated = (el: Element) =>
  Object.prototype.hasOwnProperty.call(el, 'updated');

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test('stops observing the DOM once the last panel is gone', async () => {
  const {carrier} = await load();
  fire('panel:connected', 'p1');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'observe', enabled: true});
  document.body.append(make());
  await settle();
  const before = trees(carrier);
  // Initial snapshot plus the mutation push; fewer means the observer is not
  // delivering and the assertion below would be vacuous.
  expect(before).toBeGreaterThanOrEqual(2);
  fire('panel:disconnected', 'p1');
  document.body.append(make());
  await settle();
  expect(trees(carrier)).toBe(before);
});

test('disconnects the MutationObserver', async () => {
  const spy = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const {carrier} = await load();
  fire('panel:connected', 'p1');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'observe', enabled: true});
  // Enabling already disconnects once, in syncObserverTargets.
  spy.mockClear();
  fire('panel:disconnected', 'p1');
  expect(spy).toHaveBeenCalledTimes(1);
});

test('exposes the id lookup the extension evaluates in the page', async () => {
  const {idOf} = await load();
  const el = make();
  const lookup = (globalThis as unknown as Record<symbol, unknown>)[
    ELEMENT_BY_ID_KEY
  ] as (id: number) => Element | undefined;
  expect(lookup(idOf(el))).toBe(el);
  expect(lookup(-1)).toBeUndefined();
});

test('removes the watch wrapper', async () => {
  const {carrier, idOf} = await load();
  const el = make();
  document.body.append(el);
  fire('panel:connected', 'p1');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'watch', id: idOf(el)});
  expect(hasOwnUpdated(el)).toBe(true);
  fire('panel:disconnected', 'p1');
  expect(hasOwnUpdated(el)).toBe(false);
});

test('waits for the last panel before releasing', async () => {
  const {carrier} = await load();
  fire('panel:connected', 'p1');
  fire('panel:connected', 'p2');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'observe', enabled: true});
  fire('panel:disconnected', 'p1');
  const before = trees(carrier);
  document.body.append(make());
  await settle();
  expect(trees(carrier)).toBeGreaterThan(before);
  fire('panel:disconnected', 'p2');
  const after = trees(carrier);
  document.body.append(make());
  await settle();
  expect(trees(carrier)).toBe(after);
});

test('tells a newly connected panel the runtime is up', async () => {
  const {carrier} = await load();
  const before = readies(carrier);
  fire('panel:connected', 'p9');
  expect(readies(carrier)).toBe(before + 1);
});

test('a disconnect with no Live mode and no watch is harmless', async () => {
  const {carrier} = await load();
  const before = trees(carrier);
  expect(() => {
    fire('panel:connected', 'p1');
    fire('panel:disconnected', 'p1');
    fire('panel:disconnected', 'p1');
  }).not.toThrow();
  expect(trees(carrier)).toBe(before);
});

const details = (carrier: Carrier) => count(carrier, 'details');

test('pushes live details after the update, not inside it', async () => {
  const {carrier, idOf} = await load();
  const el = make() as HTMLElement & {updated?: (c: unknown) => void};
  document.body.append(el);
  fire('panel:connected', 'p1');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'watch', id: idOf(el)});
  const afterWatch = details(carrier);
  el.updated?.(new Map());
  // Still inside performUpdate here; reading a signal now would subscribe the
  // element's render to it.
  expect(details(carrier)).toBe(afterWatch);
  await Promise.resolve();
  expect(details(carrier)).toBe(afterWatch + 1);
});

test('drops a queued live push once the watch ended', async () => {
  const {carrier, idOf} = await load();
  const el = make() as HTMLElement & {updated?: (c: unknown) => void};
  document.body.append(el);
  fire('panel:connected', 'p1');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'watch', id: idOf(el)});
  const afterWatch = details(carrier);
  el.updated?.(new Map());
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'watch', id: null});
  await Promise.resolve();
  expect(details(carrier)).toBe(afterWatch);
});

const makeSlotted = () => {
  const tag = `x-slotted-${n++}`;
  customElements.define(
    tag,
    class extends HTMLElement {
      renderRoot = this.attachShadow({mode: 'open'});
      constructor() {
        super();
        this.renderRoot.innerHTML = '<slot name="a"></slot><slot></slot>';
      }
      requestUpdate() {}
    }
  );
  return document.createElement(tag);
};

test('re-pushes details when a light child changes slot', async () => {
  const {carrier, idOf} = await load();
  const el = makeSlotted();
  el.innerHTML = '<p>one</p>';
  document.body.append(el);
  fire('panel:connected', 'p1');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'watch', id: idOf(el)});
  await settle();
  const afterWatch = details(carrier);
  el.firstElementChild!.setAttribute('slot', 'a');
  await settle();
  // Both the slot it left and the one it joined fire, but share one push.
  expect(details(carrier)).toBe(afterWatch + 1);
  const last = carrier.sent
    .filter(([, m]) => (m as {type: string}).type === 'details')
    .at(-1)![1] as {
    details: {anatomy: {slots: {name: string; status: string}[]}};
  };
  expect(last.details.anatomy.slots).toMatchObject([
    {name: 'a', status: 'assigned'},
    {name: '', status: 'empty'},
  ]);
});

test('stops listening for slot changes when the watch ends', async () => {
  const {carrier, idOf} = await load();
  const el = makeSlotted();
  document.body.append(el);
  fire('panel:connected', 'p1');
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'watch', id: idOf(el)});
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'watch', id: null});
  const afterUnwatch = details(carrier);
  el.append(document.createElement('p'));
  await settle();
  expect(details(carrier)).toBe(afterUnwatch);
});

test('answers a define-frames command, leaving out ids it never issued', async () => {
  const {carrier} = await load();
  const {rememberDefineFrames, defineIdOf} =
    await import('../../lib/runtime/define-sites.js');
  class Defined {}
  const frames = [{url: 'https://app.test/a.js', line: 4, column: 9}];
  rememberDefineFrames(Defined, frames);
  const id = defineIdOf(Defined)!;
  carrier.deliver(INSPECT_CMD_CHANNEL, {type: 'define-frames', ids: [id, -1]});
  const reply = carrier.sent.find(
    ([ch, m]) =>
      ch === INSPECT_DATA_CHANNEL &&
      (m as {type: string}).type === 'define-frames'
  );
  expect(reply?.[1]).toMatchObject({
    type: 'define-frames',
    frames: {[id]: frames},
  });
  expect(Object.keys((reply![1] as {frames: object}).frames)).toEqual([
    String(id),
  ]);
});
