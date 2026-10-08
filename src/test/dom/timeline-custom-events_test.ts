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
type CustomEvents =
  typeof import('../../lib/runtime/timeline/custom-events.js');

let counter = 0;
const originalDefine = customElements.define.bind(customElements);

/** A minimal ReactiveElement stand-in whose update calls `onUpdate`. */
const makeBase = () =>
  class FakeReactiveElement extends HTMLElement {
    hasUpdated = false;
    onUpdate: () => void = () => {};
    requestUpdate() {}
    connectedCallback() {}
    disconnectedCallback() {}
    performUpdate() {
      this.update();
      this.hasUpdated = true;
    }
    willUpdate() {}
    update() {
      this.onUpdate();
    }
    updated() {}
    firstUpdated() {}
  };

let events: TimelineEvent[];
let recording: boolean;
let enabled: boolean;

const setup = async () => {
  vi.resetModules();
  const lifecycle: Lifecycle =
    await import('../../lib/runtime/timeline/lifecycle.js');
  const custom: CustomEvents =
    await import('../../lib/runtime/timeline/custom-events.js');
  custom.installCustomEventsLayer({
    emit: (e) => events.push(e),
    recording: () => recording,
    enabled: () => enabled,
    groupOf: lifecycle.updateGroupOf,
  });
  const base = makeBase();
  const tag = `x-custom-${counter++}`;
  customElements.define(tag, class extends base {});
  const el = document.createElement(tag) as InstanceType<typeof base>;
  document.body.append(el);
  lifecycle.installLifecycleLayer(
    () => {},
    () => recording,
    () => true
  );
  return {el};
};

beforeEach(() => {
  events = [];
  recording = true;
  enabled = true;
});

afterEach(() => {
  customElements.define = originalDefine;
  document.body.innerHTML = '';
});

describe('custom events layer', () => {
  test('records type, flags, detail preview and the dispatching element', async () => {
    const {el} = await setup();
    el.dispatchEvent(
      new CustomEvent('count-changed', {
        detail: {count: 3},
        bubbles: true,
        composed: true,
      })
    );
    expect(events).toHaveLength(1);
    const [e] = events;
    expect(e!.layerId).toBe('custom-events');
    expect(e!.title).toBe('count-changed');
    expect(e!.meta?.tagName).toBe(el.localName);
    expect(e!.meta?.elementId).toBeTypeOf('number');
    expect(e!.groupId).toBeUndefined();
    expect(e!.data).toEqual({
      type: 'count-changed',
      kind: 'CustomEvent',
      bubbles: true,
      composed: true,
      cancelable: false,
      detail: '{count: 3}',
    });
  });

  test('records a plain Event without a detail', async () => {
    const {el} = await setup();
    el.dispatchEvent(new Event('change', {cancelable: true}));
    expect(events[0]!.data).toEqual({
      type: 'change',
      kind: 'Event',
      bubbles: false,
      composed: false,
      cancelable: true,
    });
  });

  test('bounds the detail preview and survives a hostile detail', async () => {
    const {el} = await setup();
    const hostile = {
      get boom(): never {
        throw new Error('no');
      },
      toString() {
        throw new Error('no');
      },
    };
    el.dispatchEvent(new CustomEvent('big', {detail: 'x'.repeat(10_000)}));
    el.dispatchEvent(new CustomEvent('bad', {detail: hostile}));
    expect(events).toHaveLength(2);
    expect((events[0]!.data as {detail: string}).detail.length).toBeLessThan(
      200
    );
  });

  test('groups an event dispatched inside an update with that tick', async () => {
    const {el} = await setup();
    el.onUpdate = () => {
      el.dispatchEvent(new CustomEvent('during'));
    };
    el.performUpdate();
    expect(events).toHaveLength(1);
    expect(events[0]!.groupId).toMatch(/^\d+:1$/);
  });

  test('records nothing while the layer is off or not recording', async () => {
    const {el} = await setup();
    enabled = false;
    el.dispatchEvent(new CustomEvent('a'));
    enabled = true;
    recording = false;
    el.dispatchEvent(new CustomEvent('b'));
    expect(events).toEqual([]);
  });

  test('still dispatches: listeners run and the result is returned', async () => {
    const {el} = await setup();
    let heard = 0;
    el.addEventListener('ping', (e) => {
      heard++;
      e.preventDefault();
    });
    const result = el.dispatchEvent(new Event('ping', {cancelable: true}));
    expect(heard).toBe(1);
    expect(result).toBe(false);
  });
});
