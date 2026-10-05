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

const SOURCE_META_KEY = Symbol.for('@oddsquad/vite-plugin-lit#source');

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
      const changed = new Map([['count', 0]]);
      this.willUpdate(changed);
      this.update(changed);
      this.hasUpdated = true;
      this.updated();
    }
    willUpdate(_changed: Map<string, unknown>) {}
    update(_changed?: Map<string, unknown>) {}
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
const install = (m: Lifecycle, changedValues = () => false) =>
  m.installLifecycleLayer(
    emit,
    () => recording,
    () => true,
    changedValues
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
  test('a subclass that overrides update and calls super emits one bracket', async () => {
    // Reproduces the double wrap: the base is wrapped from a live sample at
    // install, then define() wraps the subclass's own `update` too.
    const base = freshBase();
    const {tag: plainTag} = define(base);
    document.body.append(document.createElement(plainTag));
    install(await load());
    class Sub extends base {
      update() {
        calls.push('sub-update');
        super.update();
      }
    }
    const tag = `x-life-${counter++}`;
    customElements.define(tag, Sub);
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    events.length = 0;

    el.performUpdate();

    const titles = events.map((e) => e.title);
    expect(titles.filter((t) => t === 'update:start')).toHaveLength(1);
    expect(titles.filter((t) => t === 'update:end')).toHaveLength(1);
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
    expect(calls).toContain('sub-update');
  });

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

  test('carries the call site of an element written in a template', async () => {
    const {tag} = define();
    const stamped = document.createElement(tag) as FakeReactiveElement;
    stamped.setAttribute('data-lit-source', 'src/app.ts:12:7');
    const plain = document.createElement(tag) as FakeReactiveElement;
    document.body.append(stamped, plain);
    install(await load());
    events.length = 0;

    stamped.performUpdate();
    const first = events.length;
    plain.performUpdate();

    const callSites = events.slice(0, first).map((e) => e.meta?.callSite);
    expect(callSites.length).toBeGreaterThan(0);
    for (const site of callSites) {
      expect(site).toEqual({file: 'src/app.ts', line: 12, column: 7});
    }
    // Absent, not undefined, so older and newer recordings look alike.
    for (const e of events.slice(first)) {
      expect(e.meta).not.toHaveProperty('callSite');
    }
  });

  test('records old and new values on update:start when the layer is on', async () => {
    const {tag} = define();
    const el = document.createElement(tag) as FakeReactiveElement & {
      count: number;
    };
    el.count = 5;
    document.body.append(el);
    install(await load(), () => true);
    events.length = 0;

    el.performUpdate();

    const detailed = events.filter(
      (e) => (e.data as {changedDetail?: unknown}).changedDetail !== undefined
    );
    expect(detailed.map((e) => e.title)).toEqual(['update:start']);
    expect(detailed[0]!.data).toMatchObject({
      changedDetail: [
        {key: 'count', prev: '0', next: '5', sameRef: false, equal: false},
      ],
    });
  });

  test('records no values by default', async () => {
    const {tag} = define();
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    install(await load());
    events.length = 0;

    el.performUpdate();

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.data).not.toHaveProperty('changedDetail');
  });

  test('a throwing getter does not break the update', async () => {
    const {tag} = define();
    const el = document.createElement(tag) as FakeReactiveElement;
    Object.defineProperty(el, 'count', {
      get() {
        throw new Error('nope');
      },
    });
    document.body.append(el);
    install(await load(), () => true);
    events.length = 0;

    el.performUpdate();

    expect(events.at(-1)!.title).toBe('performUpdate:end');
    expect(events.find((e) => e.title === 'update:start')!.data).toMatchObject({
      changedDetail: [{key: 'count', next: '[getter threw]'}],
    });
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

  test('a throwing phase marks its end events, rethrows, and frees the guard', async () => {
    const base = freshBase();
    let explode = true;
    // On the base, before install, so the layer wraps the throwing method.
    base.prototype.update = function () {
      if (explode) throw new TypeError('render exploded');
    };
    const m = await load();
    install(m);
    const {tag} = define(base);
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    events.length = 0;

    expect(() => el.performUpdate()).toThrow('render exploded');

    const ends = events.filter(
      (e) => e.title === 'update:end' || e.title === 'performUpdate:end'
    );
    expect(ends).toHaveLength(2);
    for (const end of ends) {
      expect(end.logType).toBe('error');
      expect(end.data).toMatchObject({
        error: {name: 'TypeError', message: 'render exploded'},
      });
    }
    // Phases that completed before the throw are untouched.
    const willEnd = events.find((e) => e.title === 'willUpdate:end');
    expect(willEnd?.logType).toBeUndefined();

    // The in-flight flag was released: the next update still emits.
    explode = false;
    events.length = 0;
    el.performUpdate();
    const next = events.filter((e) => e.title === 'performUpdate:end');
    expect(next).toHaveLength(1);
    expect(next[0].logType).toBeUndefined();
  });

  describe('async failures', () => {
    // jsdom/happy-dom may not construct PromiseRejectionEvent; the layer only
    // reads `promise` and `reason`.
    const reject = (promise: Promise<unknown>, reason: unknown) => {
      const e = new Event('unhandledrejection');
      Object.assign(e, {promise, reason});
      window.dispatchEvent(e);
    };

    test('a rejected async phase emits <phase>:rejected in its cycle group', async () => {
      const base = freshBase();
      let pending: Promise<unknown> | undefined;
      base.prototype.updated = function () {
        pending = Promise.reject(new RangeError('late'));
        pending.catch(() => {});
        return pending;
      };
      const m = await load();
      install(m);
      const {tag} = define(base);
      const el = document.createElement(tag) as FakeReactiveElement;
      document.body.append(el);
      events.length = 0;
      el.performUpdate();
      const groupId = events.find((e) => e.title === 'updated:start')!.groupId;

      reject(pending!, new RangeError('late'));

      const rejected = events.filter((e) => e.title === 'updated:rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        groupId,
        logType: 'error',
        data: {
          phase: 'updated',
          async: true,
          error: {name: 'RangeError', message: 'late'},
        },
        meta: {tagName: tag},
      });
    });

    test("a component's own async updated() is attributed, not just the base's", async () => {
      // The real shape: the override replaces the wrapped base method instead
      // of calling through it.
      const m = await load();
      install(m);
      const {tag, Comp} = define();
      let pending: Promise<unknown> | undefined;
      (Comp.prototype as unknown as {updated: () => unknown}).updated =
        function () {
          pending = (async () => {
            null;
            throw new RangeError('after await');
          })();
          // Handled here only so the test runner sees no stray rejection;
          // the layer is driven by the synthetic event below.
          pending.catch(() => {});
          return pending;
        };
      const el = document.createElement(tag) as FakeReactiveElement;
      document.body.append(el);
      events.length = 0;
      el.performUpdate();
      const groupId = events.find(
        (e) => e.title === 'performUpdate:start'
      )!.groupId;
      reject(pending!, new RangeError('after await'));
      const rejected = events.filter((e) => e.title === 'updated:rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        groupId,
        data: {phase: 'updated', async: true},
        meta: {tagName: tag},
      });
    });

    test('a rejection of an unrelated promise emits nothing', async () => {
      const m = await load();
      install(m);
      events.length = 0;
      const other = Promise.reject(new Error('x'));
      other.catch(() => {});
      reject(other, new Error('x'));
      expect(events).toEqual([]);
    });

    test('a failed task is reported once across updates', async () => {
      const base = freshBase();
      const m = await load();
      install(m);
      const {tag} = define(base);
      const el = document.createElement(tag) as FakeReactiveElement;
      const boom = new TypeError('fetch failed');
      // Shaped as extras.ts expects: run(), render(), numeric status 3.
      const task = {run() {}, render() {}, status: 3, error: boom};
      (el as unknown as Record<string, unknown>)['userTask'] = task;
      (el as unknown as Record<string, unknown>)['__controllers'] = new Set([
        task,
      ]);
      document.body.append(el);
      events.length = 0;

      el.performUpdate();
      el.performUpdate();

      const failed = events.filter((e) => e.title === 'task:error');
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        logType: 'error',
        groupId: events.find((e) => e.title === 'performUpdate:start')!.groupId,
        data: {
          phase: 'task',
          task: 'userTask',
          async: true,
          error: {name: 'TypeError', message: 'fetch failed'},
        },
      });
    });
  });
});
