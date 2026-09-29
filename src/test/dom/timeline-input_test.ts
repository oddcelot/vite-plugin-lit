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
