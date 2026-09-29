import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';

type Lifecycle = typeof import('../../lib/runtime/timeline/lifecycle.js');

const SOURCE_META_KEY = Symbol.for('@lit-labs/vite-plugin-lit#source');

let counter = 0;
const originalDefine = customElements.define.bind(customElements);
let calls: string[];

/**
 * A minimal ReactiveElement stand-in: `performUpdate` drives the other phases
 * the way Lit does.
 */
const makeBase = () =>
  class FakeReactiveElement extends HTMLElement {
    hasUpdated = false;
    requestUpdate() {}
    connectedCallback() {
      calls.push('connected');
    }
    disconnectedCallback() {
      calls.push('disconnected');
    }
    performUpdate() {
      this.willUpdate(new Map([['count', 0]]));
      this.update();
      this.hasUpdated = true;
      this.updated();
    }
    willUpdate(_changed: Map<string, unknown>) {}
    update() {}
    updated() {}
    firstUpdated() {}
  };

// Each test needs its own prototype chain: the layer brands what it wraps, so
// a shared base would keep the first test's wrappers for every later test.
type FakeReactiveElement = InstanceType<ReturnType<typeof makeBase>>;
const freshBase = makeBase;

const load = async (): Promise<Lifecycle> => {
  vi.resetModules();
  return import('../../lib/runtime/timeline/lifecycle.js');
};

let events: TimelineEvent[];
let recording: boolean;
const emit = (e: TimelineEvent) => events.push(e);
const install = (m: Lifecycle) =>
  m.installLifecycleLayer(
    emit,
    () => recording,
    () => true
  );

const define = (base = freshBase()) => {
  const tag = `x-life-${counter++}`;
  class Comp extends base {}
  (Comp as unknown as Record<symbol, unknown>)[SOURCE_META_KEY] = {
    filePath: '/comp.ts',
    lineNumber: 4,
  };
  customElements.define(tag, Comp);
  return {tag, Comp};
};

beforeEach(() => {
  events = [];
  calls = [];
  recording = true;
});

afterEach(() => {
  customElements.define = originalDefine;
  document.body.innerHTML = '';
});

describe('installLifecycleLayer', () => {
  test('wraps the base prototype found on a live element', async () => {
    const {tag} = define();
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    events.length = 0;

    install(await load());
    el.performUpdate();

    const titles = events.map((e) => e.title);
    expect(titles).toEqual([
      'performUpdate:start',
      'willUpdate:start',
      'willUpdate:end',
      'update:start',
      'update:end',
      'updated:start',
      'updated:end',
      'performUpdate:end',
    ]);
    expect(events[0]).toMatchObject({
      layerId: 'lit-lifecycle',
      subtitle: tag,
      data: {phase: 'performUpdate'},
      meta: {tagName: tag, source: {file: '/comp.ts', line: 4}},
    });
    expect(events[1]!.data).toMatchObject({changed: ['count']});
  });

  test('a whole update cycle shares one groupId, the next cycle another', async () => {
    const {tag} = define();
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    install(await load());
    events.length = 0;

    el.performUpdate();
    const first = new Set(events.map((e) => e.groupId));
    events.length = 0;
    el.performUpdate();
    const second = new Set(events.map((e) => e.groupId));

    expect(first.size).toBe(1);
    expect(second.size).toBe(1);
    expect([...first][0]).not.toBe([...second][0]);
  });

  test('is idempotent: repeated installs do not double-wrap', async () => {
    const {tag} = define();
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    const m = await load();
    install(m);
    install(m);
    events.length = 0;

    el.performUpdate();
    expect(
      events.filter((e) => e.title === 'performUpdate:start')
    ).toHaveLength(1);
  });

  test('a second module instance sees the brand and does not re-wrap', async () => {
    const {tag} = define();
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    install(await load());
    // Fresh module state (installed=false) against already-wrapped prototypes.
    install(await load());
    events.length = 0;

    el.performUpdate();
    expect(
      events.filter((e) => e.title === 'performUpdate:start')
    ).toHaveLength(1);
  });

  test('instruments the first component defined after install', async () => {
    const base = freshBase();
    install(await load());
    // Custom elements capture lifecycle callbacks at define(), so the base
    // has to be wrapped before the first define reaches the platform.
    const {tag} = define(base);
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);

    expect(events.map((e) => e.title)).toContain('connectedCallback');
    events.length = 0;
    el.performUpdate();
    expect(events.map((e) => e.title)).toContain('performUpdate:start');
  });

  test('connect and disconnect emit single point events', async () => {
    const base = freshBase();
    install(await load());
    const {tag} = define(base);
    const el = document.createElement(tag);
    document.body.append(el);
    el.remove();

    const points = events.filter((e) => e.groupId === undefined);
    expect(points.map((e) => e.title)).toEqual([
      'connectedCallback',
      'disconnectedCallback',
    ]);
    expect(calls).toEqual(['connected', 'disconnected']);
  });

  test('emits nothing while not recording but still runs the original', async () => {
    const base = freshBase();
    install(await load());
    const {tag} = define(base);
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    events.length = 0;
    recording = false;

    el.performUpdate();
    expect(events).toEqual([]);
    expect(el.hasUpdated).toBe(true);
  });

  test('the update hook fires with first=true once, even when idle', async () => {
    const base = freshBase();
    const m = await load();
    install(m);
    const {tag} = define(base);
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    recording = false;
    const hook = vi.fn();
    m.setUpdateHook(hook);

    el.performUpdate();
    el.performUpdate();
    expect(hook.mock.calls).toEqual([
      [el, true],
      [el, false],
    ]);
  });

  test('a throwing update hook never reaches the app', async () => {
    const base = freshBase();
    const m = await load();
    install(m);
    const {tag} = define(base);
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    m.setUpdateHook(() => {
      throw new Error('overlay bug');
    });
    expect(() => el.performUpdate()).not.toThrow();
  });

  test('an update that throws still closes its bracket and skips the hook', async () => {
    const base = freshBase();
    const m = await load();
    install(m);
    const {tag, Comp} = define(base);
    Comp.prototype.update = () => {
      throw new Error('render failed');
    };
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    events.length = 0;
    const hook = vi.fn();
    m.setUpdateHook(hook);

    expect(() => el.performUpdate()).toThrow('render failed');
    expect(events.map((e) => e.title)).toContain('performUpdate:end');
    expect(hook).not.toHaveBeenCalled();
  });
});
