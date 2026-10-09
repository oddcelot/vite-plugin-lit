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

  describe('skipped updates', () => {
    // Lit asks shouldUpdate inside performUpdate and skips the phases on false.
    const vetoBase = () => {
      const base = freshBase();
      return class extends base {
        override performUpdate() {
          const changed = new Map([['count', 1]]);
          if (this.shouldUpdate(changed)) super.performUpdate();
        }
        shouldUpdate(_changed: Map<string, unknown>) {
          return true;
        }
      };
    };

    test('a veto emits one point event with the changed keys inside the tick', async () => {
      const base = vetoBase();
      const {tag: plainTag} = define(base);
      document.body.append(document.createElement(plainTag));
      install(await load());
      let veto = true;
      class Vetoer extends base {
        shouldUpdate(_changed: Map<string, unknown>) {
          return !veto;
        }
      }
      const tag = `x-life-${counter++}`;
      customElements.define(tag, Vetoer);
      const el = document.createElement(tag) as FakeReactiveElement;
      document.body.append(el);
      events.length = 0;

      el.performUpdate();

      const titles = events.map((e) => e.title);
      expect(titles).toEqual([
        'performUpdate:start',
        'update skipped',
        'performUpdate:end',
      ]);
      const start = events[0]!;
      expect(events[1]).toMatchObject({
        groupId: start.groupId,
        subtitle: tag,
        data: {phase: 'shouldUpdate', changed: ['count']},
        meta: {tagName: tag},
      });

      // Allowing the update emits no skip, and the phases run.
      veto = false;
      events.length = 0;
      el.performUpdate();
      const allowed = events.map((e) => e.title);
      expect(allowed).not.toContain('update skipped');
      expect(allowed).toContain('update:start');
    });

    test('an override that calls super and vetoes is reported once', async () => {
      const base = vetoBase();
      const {tag: plainTag} = define(base);
      document.body.append(document.createElement(plainTag));
      install(await load());
      class Inner extends base {
        shouldUpdate(_changed?: Map<string, unknown>) {
          return false;
        }
      }
      class Outer extends Inner {
        override shouldUpdate(changed?: Map<string, unknown>) {
          return super.shouldUpdate(changed);
        }
      }
      const tag = `x-life-${counter++}`;
      customElements.define(tag, Outer);
      const el = document.createElement(tag) as FakeReactiveElement;
      document.body.append(el);
      events.length = 0;

      el.performUpdate();

      expect(events.filter((e) => e.title === 'update skipped')).toHaveLength(
        1
      );
    });

    test('a vetoed tick skips the update hook, recording or not', async () => {
      const base = vetoBase();
      const {tag: plainTag} = define(base);
      document.body.append(document.createElement(plainTag));
      const m = await load();
      install(m);
      let veto = true;
      class Vetoer extends base {
        shouldUpdate(_changed: Map<string, unknown>) {
          return !veto;
        }
      }
      const tag = `x-life-${counter++}`;
      customElements.define(tag, Vetoer);
      const el = document.createElement(tag) as FakeReactiveElement;
      document.body.append(el);
      const hook = vi.fn();
      m.setUpdateHook(hook);

      el.performUpdate();
      recording = false;
      el.performUpdate();
      expect(hook).not.toHaveBeenCalled();

      veto = false;
      el.performUpdate();
      expect(hook.mock.calls).toEqual([[el, true]]);
    });

    test('a veto outside a recording is not reported', async () => {
      const base = vetoBase();
      const {tag: plainTag} = define(base);
      document.body.append(document.createElement(plainTag));
      install(await load());
      class Quiet extends base {
        shouldUpdate(_changed: Map<string, unknown>) {
          return false;
        }
      }
      const tag = `x-life-${counter++}`;
      customElements.define(tag, Quiet);
      const el = document.createElement(tag) as FakeReactiveElement;
      document.body.append(el);
      // Wrapped on the first recorded tick, then recording stops.
      el.performUpdate();
      recording = false;
      events.length = 0;

      el.performUpdate();

      expect(events).toEqual([]);
    });
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
            await Promise.resolve();
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

describe('Lit warnings', () => {
  const STATE = Symbol.for('@oddsquad/vite-plugin-lit#lit-warnings');
  const g = globalThis as Record<string | symbol, unknown>;

  afterEach(() => {
    delete g[STATE];
    delete g.litIssuedWarnings;
  });

  const warn = (tag: string) =>
    `Element ${tag} scheduled an update after an update completed. ` +
    'See https://lit.dev/msg/change-in-update for more information.';

  test('a warning issued mid-update lands as an event on that element', async () => {
    const base = freshBase();
    const {tag} = define(base);
    const el = document.createElement(tag) as FakeReactiveElement;
    document.body.append(el);
    const lifecycle = await load();
    install(lifecycle);
    const warnings = await import('../../lib/runtime/timeline/lit-warnings.js');
    const layer = await import('../../lib/runtime/timeline/warnings-layer.js');
    warnings.installLitWarningCapture();
    layer.installWarningsLayer({
      emit,
      replayTo: () => {},
      recording: () => recording,
      enabled: () => true,
      groupOf: lifecycle.updateGroupOf,
    });
    el.updated = () => {
      (g.litIssuedWarnings as Set<string>).add(warn(tag));
    };
    events.length = 0;

    el.performUpdate();

    const event = events.find((e) => e.title === 'warning:change-in-update');
    const tick = events.find((e) => e.title === 'performUpdate:start');
    expect(event).toMatchObject({
      layerId: 'lit-warnings',
      groupId: tick?.groupId,
      logType: 'warning',
      subtitle: tag,
      data: {code: 'change-in-update', phase: 'warning'},
      meta: {tagName: tag},
    });
    expect(event?.meta?.elementId).toBeTypeOf('number');
  });

  test('replays warnings to the panel only, flagged as replayed', async () => {
    g.litIssuedWarnings = new Set([warn('x-early')]);
    await load();
    const warnings = await import('../../lib/runtime/timeline/lit-warnings.js');
    const layer = await import('../../lib/runtime/timeline/warnings-layer.js');
    warnings.installLitWarningCapture();
    const replayed: TimelineEvent[] = [];
    let enabled = false;
    const {replay} = layer.installWarningsLayer({
      emit,
      replayTo: (e) => replayed.push(e),
      recording: () => recording,
      enabled: () => enabled,
      groupOf: () => 'never',
    });
    replay();
    expect(replayed).toEqual([]);

    enabled = true;
    replay();
    expect(events).toEqual([]);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      layerId: 'lit-warnings',
      subtitle: 'x-early',
      meta: {tagName: 'x-early'},
      data: {code: 'change-in-update', replayed: true},
    });
    expect(replayed[0]).not.toHaveProperty('groupId');
  });

  test('a warning with the layer off is not emitted', async () => {
    await load();
    const warnings = await import('../../lib/runtime/timeline/lit-warnings.js');
    const layer = await import('../../lib/runtime/timeline/warnings-layer.js');
    warnings.installLitWarningCapture();
    layer.installWarningsLayer({
      emit,
      replayTo: emit,
      recording: () => recording,
      enabled: () => false,
      groupOf: () => undefined,
    });

    (g.litIssuedWarnings as Set<string>).add(warn('x-quiet'));

    expect(events).toEqual([]);
  });
});

/**
 * A stand-in closer to Lit's scheduling: the constructor requests the first
 * update, `requestUpdate` enqueues once (flipping `isUpdatePending`), and
 * `performUpdate` clears the flag before `updated` the way Lit does. Updates
 * run when a test calls `performUpdate`, not on a microtask.
 */
const makeSchedulingBase = () =>
  class SchedulingElement extends HTMLElement {
    hasUpdated = false;
    isUpdatePending = false;
    requests = 0;
    onRender: () => void = () => {};
    onUpdated: () => void = () => {};
    constructor() {
      super();
      this.requestUpdate();
    }
    requestUpdate(..._args: unknown[]): string {
      this.requests++;
      if (!this.isUpdatePending) this.isUpdatePending = true;
      return 'requested';
    }
    connectedCallback() {}
    disconnectedCallback() {}
    performUpdate() {
      this.willUpdate();
      this.update();
      this.isUpdatePending = false;
      this.hasUpdated = true;
      this.updated();
    }
    willUpdate() {}
    update() {
      this.onRender();
    }
    updated() {
      this.onUpdated();
    }
    firstUpdated() {}
  };

type SchedulingElement = InstanceType<ReturnType<typeof makeSchedulingBase>>;

describe('update causes', () => {
  const setup = async () => {
    install(await load());
    const base = makeSchedulingBase();
    const make = () => {
      const tag = `x-cause-${counter++}`;
      customElements.define(tag, class extends base {});
      return tag;
    };
    return {parentTag: make(), childTag: make()};
  };

  const starts = (el: Element) =>
    events.filter(
      (e) =>
        e.title === 'performUpdate:start' && e.meta?.tagName === el.localName
    );

  test("a parent's render setting a child property names the parent's tick", async () => {
    const {parentTag, childTag} = await setup();
    const parent = document.createElement(parentTag) as SchedulingElement;
    const child = document.createElement(childTag) as SchedulingElement;
    document.body.append(parent, child);
    parent.performUpdate();
    child.performUpdate();
    events.length = 0;

    parent.onRender = () => {
      // What a property binding does: set, and the setter requests.
      child.requestUpdate('value', 0);
    };
    parent.requestUpdate();
    parent.performUpdate();
    child.performUpdate();

    const [parentStart] = starts(parent);
    const [childStart] = starts(child);
    expect(parentStart!.cause).toBeUndefined();
    expect(childStart!.cause).toEqual({
      kind: 'update',
      groupId: parentStart!.groupId,
    });
    expect(parentStart!.groupId).toMatch(/^\d+:2$/);
  });

  test("a child created in a parent's first render gets the parent's tick", async () => {
    const {parentTag, childTag} = await setup();
    const parent = document.createElement(parentTag) as SchedulingElement;
    let child: SchedulingElement | undefined;
    parent.onRender = () => {
      child = document.createElement(childTag) as SchedulingElement;
      parent.append(child);
    };
    document.body.append(parent);
    parent.performUpdate();
    child!.performUpdate();

    const [parentStart] = starts(parent);
    expect(starts(child!)[0]!.cause).toEqual({
      kind: 'update',
      groupId: parentStart!.groupId,
    });
  });

  test('a request made in its own updated() names its own previous tick', async () => {
    const {parentTag} = await setup();
    const el = document.createElement(parentTag) as SchedulingElement;
    document.body.append(el);
    let once = true;
    el.onUpdated = () => {
      if (once) el.requestUpdate();
      once = false;
    };
    el.performUpdate();
    el.performUpdate();

    const [first, second] = starts(el);
    expect(second!.cause).toEqual({kind: 'update', groupId: first!.groupId});
  });

  test('a request from a timer with nothing running has no cause', async () => {
    const {parentTag} = await setup();
    const el = document.createElement(parentTag) as SchedulingElement;
    document.body.append(el);
    el.performUpdate();
    events.length = 0;

    await new Promise<void>((resolve) =>
      setTimeout(() => {
        el.requestUpdate();
        resolve();
      })
    );
    el.performUpdate();

    expect(starts(el)).toHaveLength(1);
    expect(starts(el)[0]).not.toHaveProperty('cause');
  });

  test('only the request that enqueues the update counts', async () => {
    const {parentTag, childTag} = await setup();
    const parent = document.createElement(parentTag) as SchedulingElement;
    const child = document.createElement(childTag) as SchedulingElement;
    document.body.append(parent, child);
    parent.performUpdate();
    child.performUpdate();
    events.length = 0;

    child.requestUpdate(); // first, from nowhere: no cause
    parent.onRender = () => child.requestUpdate('value', 0);
    parent.requestUpdate();
    parent.performUpdate();
    child.performUpdate();

    expect(starts(child)[0]).not.toHaveProperty('cause');
  });

  test('not recording, requestUpdate passes straight through', async () => {
    const {parentTag, childTag} = await setup();
    const parent = document.createElement(parentTag) as SchedulingElement;
    const child = document.createElement(childTag) as SchedulingElement;
    document.body.append(parent, child);
    parent.performUpdate();
    child.performUpdate();
    recording = false;

    parent.onRender = () => {
      expect(child.requestUpdate('value', 0)).toBe('requested');
    };
    parent.requestUpdate();
    parent.performUpdate();
    expect(child.isUpdatePending).toBe(true);
    const before = child.requests;
    expect(child.requestUpdate()).toBe('requested');
    expect(child.requests).toBe(before + 1);
    expect(child.isUpdatePending).toBe(true);

    recording = true;
    events.length = 0;
    child.performUpdate();
    expect(child.isUpdatePending).toBe(false);
    expect(starts(child)[0]).not.toHaveProperty('cause');
  });
});

describe('@lit/task runs', () => {
  type Deferred = {promise: Promise<string>; resolve: (v: string) => void};
  const deferred = (): Deferred => {
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => (resolve = r));
    return {promise, resolve};
  };

  /** Settles promise continuations: run()'s, then our `.then` on it. */
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

  const setup = async () => {
    install(await load());
    const {Task} = await import('@lit/task');
    const base = makeSchedulingBase();
    /** Where Lit keeps controllers, and where it calls `hostUpdate`. */
    class TaskHostBase extends base {
      __controllers = new Set<{hostUpdate?(): void}>();
      addController(c: {hostUpdate?(): void}) {
        this.__controllers.add(c);
      }
      removeController(c: {hostUpdate?(): void}) {
        this.__controllers.delete(c);
      }
      override willUpdate() {
        for (const c of this.__controllers) c.hostUpdate?.();
      }
    }
    const runs: Deferred[] = [];
    const returned: Promise<unknown>[] = [];
    /** Records what the original `run` returned, to compare with the wrapper's. */
    class SpyTask<A extends readonly unknown[], R> extends Task<A, R> {
      override run(args?: A): Promise<void> {
        const p = super.run(args);
        returned.push(p);
        return p;
      }
    }
    const tag = `x-task-${counter++}`;
    class Host extends TaskHostBase {
      userId = 1;
      userTask = new SpyTask(this as never, {
        task: () => {
          const d = deferred();
          runs.push(d);
          return d.promise;
        },
        args: () => [this.userId] as const,
      });
    }
    customElements.define(tag, Host);
    const host = document.createElement(tag) as InstanceType<typeof Host>;
    document.body.append(host);
    return {host, runs, returned};
  };

  const byTitle = (title: string) => events.filter((e) => e.title === title);

  test('a run started in an update names that tick, and its completion causes the next', async () => {
    const {host, runs} = await setup();
    host.performUpdate();

    const [tick] = byTitle('performUpdate:start');
    const [start] = byTitle('task:start');
    expect(start).toMatchObject({
      layerId: 'lit-lifecycle',
      subtitle: host.localName,
      data: {phase: 'task', task: 'userTask'},
      cause: {kind: 'update', groupId: tick!.groupId},
    });
    expect(String(start!.groupId)).toMatch(/^task:\d+:\d+$/);
    // The pending request was absorbed by the update it ran in.
    expect(host.isUpdatePending).toBe(false);

    runs[0]!.resolve('ada');
    await flush();
    expect(host.isUpdatePending).toBe(true);
    host.performUpdate();

    const [, next] = byTitle('performUpdate:start');
    expect(next!.cause).toEqual({kind: 'task', groupId: start!.groupId});
    const [end] = byTitle('task:end');
    expect(end).toMatchObject({
      groupId: start!.groupId,
      data: {phase: 'task', task: 'userTask', status: 'complete'},
    });
    expect(end).not.toHaveProperty('logType');
    expect(end!.data).not.toHaveProperty('superseded');
  });

  test('the completion request is consumed once', async () => {
    const {host, runs} = await setup();
    host.performUpdate();
    runs[0]!.resolve('ada');
    await flush();
    host.performUpdate();
    events.length = 0;

    await new Promise<void>((resolve) =>
      setTimeout(() => {
        host.requestUpdate();
        resolve();
      })
    );
    host.performUpdate();
    expect(byTitle('performUpdate:start')[0]).not.toHaveProperty('cause');
  });

  test('a superseded run ends marked, and only the latest completion is a cause', async () => {
    const {host, runs} = await setup();
    host.performUpdate();
    host.userId = 2;
    host.requestUpdate();
    host.performUpdate();
    const [first, second] = byTitle('task:start');
    expect(runs).toHaveLength(2);

    runs[0]!.resolve('ada');
    await flush();
    // The stale run asks for nothing.
    expect(host.isUpdatePending).toBe(false);
    const [firstEnd] = byTitle('task:end');
    expect(firstEnd).toMatchObject({
      groupId: first!.groupId,
      data: {superseded: true},
    });

    runs[1]!.resolve('grace');
    await flush();
    host.performUpdate();
    const ends = byTitle('task:end');
    expect(ends[1]).toMatchObject({
      groupId: second!.groupId,
      data: {status: 'complete'},
    });
    expect(ends[1]!.data).not.toHaveProperty('superseded');
    const ticks = byTitle('performUpdate:start');
    expect(ticks[ticks.length - 1]!.cause).toEqual({
      kind: 'task',
      groupId: second!.groupId,
    });
  });

  test('the wrapper returns the promise run() returned', async () => {
    const {host, returned} = await setup();
    host.performUpdate();
    const result = host.userTask.run([3]);
    expect(result).toBe(returned[returned.length - 1]);
  });

  test('not recording, run passes straight through', async () => {
    const {host, runs, returned} = await setup();
    host.performUpdate();
    recording = false;
    events.length = 0;

    const result = host.userTask.run([5]);
    expect(result).toBe(returned[returned.length - 1]);
    runs[runs.length - 1]!.resolve('linus');
    await flush();
    expect(events).toEqual([]);
  });
});
