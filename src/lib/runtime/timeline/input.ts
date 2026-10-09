/**
 * Mouse and keyboard timeline layers — plain window listeners, direct port
 * of the Vue DevTools timeline input capture pattern.
 */

import type {TimelineEvent} from '../../../types/timeline.js';
import {now} from './clock.js';
import {markEventCause} from './cause-context.js';

type EmitFn = (event: TimelineEvent) => void;
type RecordingFn = () => boolean;

const MOUSE_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
] as const satisfies readonly string[];

const KEY_EVENTS = ['keydown', 'keyup'] as const satisfies readonly string[];

interface MouseData {
  type: string;
  x: number;
  y: number;
  button: number;
}

interface KeyData {
  type: string;
  key: string;
  code: string;
  modifiers: string[];
}

const mouseHandler =
  (emit: EmitFn, recording: RecordingFn, mouseEnabled: () => boolean) =>
  (e: Event): void => {
    if (!recording() || !mouseEnabled()) return;
    const me = e as MouseEvent;
    const data: MouseData = {
      type: e.type,
      x: Math.round(me.clientX),
      y: Math.round(me.clientY),
      button: me.button,
    };
    const time = now();
    // Handlers that run after this capture listener find the row again
    // through `window.event`, so an update they request names this click.
    markEventCause(e, {layerId: 'mouse', time, title: e.type});
    emit({
      layerId: 'mouse',
      time,
      title: e.type,
      subtitle: `(${data.x}, ${data.y})`,
      data,
    });
  };

const keyHandler =
  (emit: EmitFn, recording: RecordingFn, keyEnabled: () => boolean) =>
  (e: Event): void => {
    if (!recording() || !keyEnabled()) return;
    const ke = e as KeyboardEvent;
    const modifiers: string[] = [];
    if (ke.ctrlKey) modifiers.push('Ctrl');
    if (ke.metaKey) modifiers.push('Meta');
    if (ke.altKey) modifiers.push('Alt');
    if (ke.shiftKey) modifiers.push('Shift');
    const data: KeyData = {
      type: e.type,
      key: ke.key,
      code: ke.code,
      modifiers,
    };
    const time = now();
    markEventCause(e, {layerId: 'keyboard', time, title: ke.key});
    emit({
      layerId: 'keyboard',
      time,
      title: ke.key,
      subtitle: modifiers.length ? modifiers.join('+') : undefined,
      data,
    });
  };

let mouseCleanup: (() => void) | null = null;
let keyCleanup: (() => void) | null = null;

export const installMouseLayer = (
  emit: EmitFn,
  recording: RecordingFn,
  mouseEnabled: () => boolean
): void => {
  if (mouseCleanup !== null) return;
  const handler = mouseHandler(emit, recording, mouseEnabled);
  for (const type of MOUSE_EVENTS) {
    window.addEventListener(type, handler, {capture: true, passive: true});
  }
  mouseCleanup = () => {
    for (const type of MOUSE_EVENTS) {
      window.removeEventListener(type, handler, {capture: true});
    }
  };
};

export const installKeyboardLayer = (
  emit: EmitFn,
  recording: RecordingFn,
  keyEnabled: () => boolean
): void => {
  if (keyCleanup !== null) return;
  const handler = keyHandler(emit, recording, keyEnabled);
  for (const type of KEY_EVENTS) {
    window.addEventListener(type, handler, {capture: true, passive: true});
  }
  keyCleanup = () => {
    for (const type of KEY_EVENTS) {
      window.removeEventListener(type, handler, {capture: true});
    }
  };
};
