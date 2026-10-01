import {afterEach, expect, test, vi} from 'vite-plus/test';
import {LitElement} from 'lit';
import {Task} from '@lit/task';
import {Signal} from '@lit-labs/signals';
import {collectExtras} from '../../lib/runtime/inspector/extras.js';

let counter = 0;

/** A ReactiveElement look-alike whose instance state a test sets directly. */
const host = (
  declared: string[] = []
): HTMLElement & Record<string, unknown> => {
  const tag = `x-extras-${counter++}`;
  class El extends HTMLElement {
    static elementProperties = new Map(declared.map((k) => [k, {}]));
    hasUpdated = false;
    isUpdatePending = false;
    requestUpdate() {}
  }
  customElements.define(tag, El);
  return document.createElement(tag) as HTMLElement & Record<string, unknown>;
};

/** Stand-ins named like the signal-polyfill classes the collector looks for. */
class State {
  constructor(private v: unknown) {}
  get() {
    return this.v;
  }
  set(v: unknown) {
    this.v = v;
  }
}
class Computed {
  get = vi.fn(() => {
    throw new Error('computed must not be evaluated');
  });
}

const taskLike = (status: number, extra: Record<string, unknown> = {}) => ({
  status,
  value: [1, 2],
  error: undefined,
  run() {},
  render() {},
  ...extra,
});

afterEach(() => {
  document.body.replaceChildren();
});

test('a plain Lit element has no extras', async () => {
  class Plain extends LitElement {
    static properties = {a: {}};
    declare a: number;
    constructor() {
      super();
      this.a = 1;
    }
  }
  customElements.define('x-extras-plain', Plain);
  const el = new Plain();
  document.body.append(el);
  await el.updateComplete;
  expect(collectExtras(el)).toEqual([]);
});

test('reads a real @lit/task and its field name', async () => {
  class WithTask extends LitElement {
    userTask = new Task(this, {
      task: async () => [1, 2],
      args: () => [],
    });
  }
  customElements.define('x-extras-task', WithTask);
  const el = new WithTask();
  document.body.append(el);
  await el.updateComplete;
  await el.userTask.taskComplete;
  expect(collectExtras(el)).toEqual([
    {
      kind: 'task',
      name: 'userTask',
      value: '[1, 2]',
      type: 'Task',
      status: 'complete',
    },
  ]);
});

test('reads a real Signal.State and never evaluates a Computed', async () => {
  class WithSignal extends LitElement {
    count = new Signal.State(7);
    doubled = new Signal.Computed(() => this.count.get() * 2);
  }
  customElements.define('x-extras-signal', WithSignal);
  const el = new WithSignal();
  document.body.append(el);
  await el.updateComplete;
  expect(collectExtras(el)).toEqual([
    {kind: 'signal', name: 'count', value: '7', type: 'Signal.State'},
    {kind: 'signal', name: 'doubled', value: '(computed)', type: 'Computed'},
  ]);
});

test('lists controllers under the dev and the production field name', () => {
  for (const key of ['__controllers', '_$EO']) {
    const el = host();
    el[key] = new Set([{hostConnected() {}, value: 3}]);
    expect(collectExtras(el)).toEqual([
      {kind: 'controller', name: 'Object', value: '3', type: 'Object'},
    ]);
  }
});

test('missing or non-Set controller storage is ignored', () => {
  expect(collectExtras(host())).toEqual([]);
  const el = host();
  el['__controllers'] = ['not a set'];
  el['_$EO'] = {size: 1};
  expect(collectExtras(el)).toEqual([]);
});

test('a task in a field and in the controller set is listed once', () => {
  const task = taskLike(2);
  const el = host();
  el['userTask'] = task;
  el['__controllers'] = new Set([task]);
  const extras = collectExtras(el);
  expect(extras).toEqual([
    {
      kind: 'task',
      name: 'userTask',
      value: '[1, 2]',
      type: 'Task',
      status: 'complete',
    },
  ]);
});

test('previews a failed task by its error and maps every status', () => {
  const el = host();
  el['bad'] = taskLike(3, {error: new Error('x')});
  el['wait'] = taskLike(1);
  el['idle'] = taskLike(0);
  const [bad, wait, idle] = collectExtras(el);
  expect(bad).toMatchObject({name: 'bad', status: 'error'});
  expect(bad!.value).toContain('Error');
  expect(wait).toMatchObject({name: 'wait', status: 'pending'});
  expect(idle).toMatchObject({name: 'idle', status: 'initial'});
});

test('reads a State-shaped signal but never calls get on a Computed', () => {
  const el = host();
  const computed = new Computed();
  el['count'] = new State(7);
  el['derived'] = computed;
  expect(collectExtras(el)).toEqual([
    {kind: 'signal', name: 'count', value: '7', type: 'Signal.State'},
    {kind: 'signal', name: 'derived', value: '(computed)', type: 'Computed'},
  ]);
  expect(computed.get).not.toHaveBeenCalled();
});

test('a Map is not mistaken for a signal', () => {
  const el = host();
  el['cache'] = new Map([[1, 2]]);
  expect(collectExtras(el)).toEqual([
    {kind: 'field', name: 'cache', value: 'Map(1)', type: 'Map(1)'},
  ]);
});

test('lists plain fields and filters out the rest', () => {
  const el = host(['declared']);
  el['declared'] = 1;
  el['counter'] = 0;
  el['items'] = [1];
  el['handler'] = () => {};
  el['__private'] = 1;
  el['_$mangled'] = 1;
  el['renderRoot'] = document.createElement('div');
  el['child'] = document.createElement('div');
  expect(collectExtras(el)).toEqual([
    {kind: 'field', name: 'counter', value: '0', type: 'number'},
    {kind: 'field', name: 'items', value: '[1]', type: 'Array(1)'},
  ]);
});

test('caps the list', () => {
  const el = host();
  for (let i = 0; i < 40; i++) el[`f${i}`] = i;
  expect(collectExtras(el)).toHaveLength(24);
});

test('never invokes an accessor on the element or on a controller', () => {
  const el = host();
  const getter = vi.fn(() => 1);
  Object.defineProperty(el, 'lazy', {get: getter, enumerable: true});
  el['ok'] = 1;
  const ctrl = {};
  Object.defineProperty(ctrl, 'value', {get: getter});
  el['__controllers'] = new Set([ctrl]);
  expect(collectExtras(el)).toEqual([
    {kind: 'controller', name: 'Object', value: 'Object', type: 'Object'},
    {kind: 'field', name: 'ok', value: '1', type: 'number'},
  ]);
  expect(getter).not.toHaveBeenCalled();
});

test('survives a hostile toString, a cyclic value and a throwing State', () => {
  const el = host();
  const cyc: Record<string, unknown> = {};
  cyc['self'] = cyc;
  el['cyc'] = cyc;
  el['hostile'] = {
    toString() {
      throw new Error('no');
    },
    toJSON() {
      throw new Error('no');
    },
  };
  const bad = new State(0);
  bad.get = () => {
    throw new Error('boom');
  };
  el['sig'] = bad;
  const extras = collectExtras(el);
  expect(extras.map((e) => e.name)).toEqual(['sig', 'cyc', 'hostile']);
  expect(extras[0]!.value).toBe('[getter threw]');
  expect(extras[1]!.value).toContain('[Circular]');
});

test('reading a signal inside a computed subscribes it (why the push is deferred)', () => {
  const el = host();
  const count = new Signal.State(5);
  el['count'] = count;
  const inside = new Signal.Computed(() => {
    collectExtras(el);
    return 0;
  });
  inside.get();
  expect(Signal.subtle.introspectSources(inside)).toHaveLength(1);

  const outside = new Signal.Computed(() => 0);
  collectExtras(el);
  outside.get();
  expect(Signal.subtle.introspectSources(outside)).toHaveLength(0);
});
