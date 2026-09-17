/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * "Flash on update": a short, non-interactive outline over every Lit element
 * that just finished an update cycle, so re-render churn is visible on the
 * page itself rather than only in the Updates tab.
 *
 * Sibling of the inspector's hover outline, not a reuse of it — many elements
 * can flash in the same frame, and each box has its own fade. Same drawing
 * rules though: one `position: fixed` layer with `pointer-events: none` so the
 * page stays fully interactive underneath.
 *
 * Fed by the lifecycle layer's update hook (see `setUpdateHook` in
 * `lifecycle.ts`), which fires whether or not the timeline is recording. Rects
 * are measured once per animation frame for every element that updated in it,
 * so a tick that updates a hundred components costs one layout, not a hundred.
 *
 * Off by default; the panel turns it on through the settings override.
 */

import type {UpdateHook} from './lifecycle.js';

/** Fade length; long enough to catch, short enough not to smear. */
const DURATION_MS = 450;

/** How far back the ramp counts updates for one element. */
const RAMP_WINDOW_MS = 1000;

/**
 * Outline/fill colours by heat level. Level 0 is also the flat colour used
 * when the ramp is off. Deliberately not the selection blue, so a hovered
 * element and a flashing one read differently.
 */
const COLORS: readonly string[] = [
  'hsl(158 74% 53%)', // calm — one update
  '#f4bf4f', // warm
  '#f4844f', // hot
  '#ef4444', // on fire
];

/**
 * Heat level for `count` updates of one element inside the ramp window.
 * Exported for the unit test; the thresholds are the whole behaviour.
 */
export const rampLevel = (count: number): number => {
  if (count >= 8) return 3;
  if (count >= 4) return 2;
  if (count >= 2) return 1;
  return 0;
};

let enabled = false;
let ramp = false;

let layer: HTMLElement | null = null;

/** Elements that updated since the last flush, with "was a first update". */
const pending = new Map<Element, boolean>();
let frame: number | null = null;

/** Boxes currently on screen, so a re-flash restarts instead of stacking. */
const active = new Map<Element, {box: HTMLElement; anim: Animation}>();

/** Recent update timestamps per element, for the ramp. */
const history = new WeakMap<Element, number[]>();

const ensureLayer = (): HTMLElement => {
  if (layer === null) {
    layer = document.createElement('div');
    layer.setAttribute('data-lit-devtools-flash-layer', '');
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483645',
      pointerEvents: 'none',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.append(layer);
  }
  return layer;
};

/** The runtime's own UI (indicator, panels) must not flash itself. */
const isDevtoolsElement = (el: Element): boolean =>
  el.localName.startsWith('lit-devtools-');

const recordUpdate = (el: Element, at: number): number => {
  let times = history.get(el);
  if (times === undefined) {
    times = [];
    history.set(el, times);
  }
  times.push(at);
  const cutoff = at - RAMP_WINDOW_MS;
  while (times.length > 0 && times[0]! < cutoff) times.shift();
  return times.length;
};

const removeBox = (el: Element, anim: Animation): void => {
  const entry = active.get(el);
  // A newer flash may have replaced this one; only the owner cleans up.
  if (entry === undefined || entry.anim !== anim) return;
  entry.box.remove();
  active.delete(el);
};

const paint = (
  el: Element,
  rect: DOMRect,
  level: number,
  first: boolean
): void => {
  const color = COLORS[level] ?? COLORS[0]!;
  let entry = active.get(el);
  if (entry === undefined) {
    const box = document.createElement('div');
    box.setAttribute('data-lit-devtools-flash', '');
    Object.assign(box.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      borderRadius: '2px',
      willChange: 'opacity',
    } satisfies Partial<CSSStyleDeclaration>);
    ensureLayer().append(box);
    entry = {box, anim: box.animate([], {duration: 0})};
    active.set(el, entry);
  } else {
    entry.anim.cancel();
  }
  const {box} = entry;
  box.setAttribute('data-level', String(level));
  Object.assign(box.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    outline: `2px solid ${color}`,
    outlineOffset: '-1px',
    background: color,
  } satisfies Partial<CSSStyleDeclaration>);
  // Mounts flash fainter: a page filling in is not the churn we're hunting.
  const peak = first ? 0.35 : 0.75;
  const anim = box.animate(
    [{opacity: peak}, {opacity: peak, offset: 0.3}, {opacity: 0}],
    {duration: DURATION_MS, easing: 'ease-out', fill: 'forwards'}
  );
  entry.anim = anim;
  anim.onfinish = () => removeBox(el, anim);
  anim.oncancel = () => {
    /* replaced by a newer flash; that one owns cleanup */
  };
};

const flush = (): void => {
  frame = null;
  if (!enabled) {
    pending.clear();
    return;
  }
  const now = performance.now();
  for (const [el, first] of pending) {
    if (!el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    // `display: contents` hosts, hidden elements, and off-DOM work have no
    // box worth drawing.
    if (rect.width === 0 || rect.height === 0) continue;
    const count = recordUpdate(el, now);
    paint(el, rect, ramp ? rampLevel(count) : 0, first);
  }
  pending.clear();
};

const clearAll = (): void => {
  pending.clear();
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  for (const {box, anim} of active.values()) {
    anim.cancel();
    box.remove();
  }
  active.clear();
};

/** Turn the overlay on or off; off also wipes whatever is mid-fade. */
export const setFlashEnabled = (on: boolean): void => {
  if (enabled === on) return;
  enabled = on;
  if (!on) clearAll();
};

/** Colour by update frequency instead of the flat colour. */
export const setFlashRamp = (on: boolean): void => {
  ramp = on;
};

/**
 * The lifecycle layer's update hook. Cheap on the hot path: one Map write and,
 * at most, one `requestAnimationFrame` per frame; all measuring happens in
 * the flush.
 */
export const flashUpdate: UpdateHook = (el, first) => {
  if (!enabled || isDevtoolsElement(el)) return;
  // Several updates of one element in the same frame collapse into one box;
  // it only counts as a mount if every one of them was the first update.
  pending.set(el, (pending.get(el) ?? true) && first);
  if (frame === null) frame = requestAnimationFrame(flush);
};
