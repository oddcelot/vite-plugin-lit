import {beforeEach, describe, expect, test, vi} from 'vite-plus/test';
import type {TimelineEvent} from '../../types/timeline.js';

type Input = typeof import('../../lib/runtime/timeline/input.js');

let events: TimelineEvent[];
let recording: boolean;
let enabled: boolean;
// Listeners from earlier tests stay on window; each test's emit writes to
// its own array so those stale listeners cannot inflate this test's count.
let emit: (e: TimelineEvent) => void;

const load = async (): Promise<Input> => {
  vi.resetModules();
  return import('../../lib/runtime/timeline/input.js');
};

beforeEach(() => {
  const sink: TimelineEvent[] = [];
  events = sink;
  emit = (e) => {
    sink.push(e);
  };
  recording = true;
  enabled = true;
});

describe('installMouseLayer', () => {
  test('records rounded coordinates and button for each mouse event', async () => {
    const m = await load();
    m.installMouseLayer(
      emit,
      () => recording,
      () => enabled
    );
    document.body.dispatchEvent(
      new MouseEvent('click', {
        clientX: 10.6,
        clientY: 20.2,
        button: 1,
        bubbles: true,
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      layerId: 'mouse',
      title: 'click',
      subtitle: '(11, 20)',
      data: {type: 'click', x: 11, y: 20, button: 1},
    });
  });

  test('covers down, up, click and double-click but not moves', async () => {
    const m = await load();
    m.installMouseLayer(
      emit,
      () => recording,
      () => enabled
    );
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
      window.dispatchEvent(new MouseEvent(type));
    }
    window.dispatchEvent(new MouseEvent('mousemove'));
    expect(events.map((e) => e.title)).toEqual([
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
    ]);
  });

  test('is filtered by the recording flag and the layer toggle', async () => {
    const m = await load();
    m.installMouseLayer(
      emit,
      () => recording,
      () => enabled
    );
    recording = false;
    window.dispatchEvent(new MouseEvent('click'));
    recording = true;
    enabled = false;
    window.dispatchEvent(new MouseEvent('click'));
    expect(events).toEqual([]);
    enabled = true;
    window.dispatchEvent(new MouseEvent('click'));
    expect(events).toHaveLength(1);
  });

  test('installing twice registers one listener', async () => {
    const m = await load();
    const args = [emit, () => recording, () => enabled] as const;
    m.installMouseLayer(...args);
    m.installMouseLayer(...args);
    window.dispatchEvent(new MouseEvent('mousedown'));
    expect(events).toHaveLength(1);
  });
});

describe('installKeyboardLayer', () => {
  test('records the key, code and held modifiers', async () => {
    const m = await load();
    m.installKeyboardLayer(
      emit,
      () => recording,
      () => enabled
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        shiftKey: true,
      })
    );
    expect(events[0]).toMatchObject({
      layerId: 'keyboard',
      title: 'k',
      subtitle: 'Ctrl+Shift',
      data: {
        type: 'keydown',
        key: 'k',
        code: 'KeyK',
        modifiers: ['Ctrl', 'Shift'],
      },
    });
  });

  test('has no subtitle without modifiers and orders them Ctrl Meta Alt Shift', async () => {
    const m = await load();
    m.installKeyboardLayer(
      emit,
      () => recording,
      () => enabled
    );
    window.dispatchEvent(new KeyboardEvent('keyup', {key: 'a'}));
    window.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'b',
        shiftKey: true,
        altKey: true,
        metaKey: true,
        ctrlKey: true,
      })
    );
    expect(events[0]!.subtitle).toBeUndefined();
    expect(events[1]!.subtitle).toBe('Ctrl+Meta+Alt+Shift');
  });

  test('is filtered by the recording flag and the layer toggle', async () => {
    const m = await load();
    m.installKeyboardLayer(
      emit,
      () => recording,
      () => enabled
    );
    recording = false;
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    recording = true;
    enabled = false;
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    expect(events).toEqual([]);
  });

  test('installing twice registers one listener', async () => {
    const m = await load();
    const args = [emit, () => recording, () => enabled] as const;
    m.installKeyboardLayer(...args);
    m.installKeyboardLayer(...args);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    expect(events).toHaveLength(1);
  });
});

describe('input events as update causes', () => {
  test("a click handler's requestUpdate names the mouse row", async () => {
    vi.resetModules();
    const lifecycle = await import('../../lib/runtime/timeline/lifecycle.js');
    const m = await import('../../lib/runtime/timeline/input.js');
    m.installMouseLayer(
      emit,
      () => recording,
      () => enabled
    );
    lifecycle.installLifecycleLayer(
      emit,
      () => recording,
      () => true
    );
    class Clickable extends HTMLElement {
      isUpdatePending = false;
      requestUpdate() {
        this.isUpdatePending = true;
      }
      performUpdate() {
        this.isUpdatePending = false;
      }
    }
    const tag = `x-input-cause-${Math.random().toString(36).slice(2)}`;
    customElements.define(tag, Clickable);
    const el = document.createElement(tag) as Clickable;
    document.body.append(el);
    // The handler lives in a shadow tree, as a Lit component's do: the DOM
    // leaves `window.event` unset there, so the cause must be found another
    // way (the event is still dispatching while its handler runs).
    const button = document.createElement('button');
    el.attachShadow({mode: 'open'}).append(button);
    button.addEventListener('click', () => el.requestUpdate());

    button.dispatchEvent(
      new MouseEvent('click', {bubbles: true, composed: true})
    );
    el.performUpdate();
    el.remove();

    const row = events.find((e) => e.layerId === 'mouse');
    const start = events.find((e) => e.title === 'performUpdate:start');
    expect(start!.cause).toEqual({
      kind: 'event',
      layerId: 'mouse',
      time: row!.time,
      title: 'click',
    });
  });
});
