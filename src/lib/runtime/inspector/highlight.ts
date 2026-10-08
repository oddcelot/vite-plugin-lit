/**
 * The hover outline the panel draws over an element in the page.
 *
 * Its own module because two transports drive it: the in-page channel (the
 * fast path, no server in the loop) and the Vite HMR command channel (the
 * fallback, for a panel with no page script to handshake with). Both end up
 * here, so the box is created once and behaves identically either way.
 *
 * Deliberately independent of the source overlay, which draws its own,
 * richer highlight — this one has to work whether or not `sourceOverlay` is
 * enabled.
 */

import {elementById} from '../timeline/identity.js';

let box: HTMLElement | null = null;

const ensureBox = (): HTMLElement => {
  if (box === null) {
    box = document.createElement('div');
    box.setAttribute('data-lit-devtools-highlight', '');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: '2147483646',
      pointerEvents: 'none',
      background: 'rgba(77, 99, 255, 0.25)',
      outline: '1px solid #4d63ff',
      borderRadius: '2px',
      transition: 'all 80ms ease-out',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.append(box);
  }
  return box;
};

/** Draw the outline over `el`. */
export const showHighlight = (el: Element): void => {
  hideMany();
  const r = el.getBoundingClientRect();
  Object.assign(ensureBox().style, {
    display: 'block',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
};

/** Most elements outlined at once, so a long list cannot flood the page. */
export const MAX_OUTLINES = 200;

/** The outlines for {@link highlightAll}, grown on demand and reused. */
const many: HTMLElement[] = [];

const manyBox = (i: number): HTMLElement => {
  let b = many[i];
  if (b === undefined) {
    b = document.createElement('div');
    b.setAttribute('data-lit-devtools-highlight-all', '');
    Object.assign(b.style, {
      position: 'fixed',
      zIndex: '2147483646',
      pointerEvents: 'none',
      // Lighter and dashed, so many at once read as a set, not as one pick.
      background: 'rgba(77, 99, 255, 0.12)',
      outline: '1px dashed #4d63ff',
      borderRadius: '2px',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.append(b);
    many[i] = b;
  }
  return b;
};

const hideMany = (from = 0): void => {
  for (let i = from; i < many.length; i++) many[i]!.style.display = 'none';
};

/** Hide every outline. Cheap and safe before any box has been built. */
export const clearHighlight = (): void => {
  if (box !== null) box.style.display = 'none';
  hideMany();
};

/**
 * Outline each element in `ids` that still resolves and is on screen,
 * replacing the single hover outline. Returns how many were drawn.
 */
export const highlightAll = (ids: readonly number[]): number => {
  if (box !== null) box.style.display = 'none';
  let drawn = 0;
  for (const id of ids) {
    if (drawn === MAX_OUTLINES) break;
    const el = elementById(id);
    if (el === undefined) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    Object.assign(manyBox(drawn).style, {
      display: 'block',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    drawn++;
  }
  hideMany(drawn);
  return drawn;
};

/**
 * Outline the element with this id, or clear it for `null` — and also when
 * the id no longer resolves, since a stale outline over the wrong element is
 * worse than none.
 */
export const highlightById = (id: number | null): void => {
  if (id === null) {
    clearHighlight();
    return;
  }
  const el = elementById(id);
  if (el !== undefined) showHighlight(el);
  else clearHighlight();
};

/** How long the outline follows a revealed element, scroll included. */
const REVEAL_MS = 1200;
let revealFrame = 0;

/**
 * Scroll the element with this id into view and outline it until the scroll
 * has settled. The box is `position: fixed`, so it is redrawn every frame
 * while the page scrolls rather than once at the start. Unknown ids do
 * nothing.
 */
export const revealById = (id: number): void => {
  const el = elementById(id);
  if (el === undefined) return;
  const reduce = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  ).matches;
  el.scrollIntoView({
    block: 'center',
    inline: 'nearest',
    behavior: reduce === true ? 'auto' : 'smooth',
  });
  cancelAnimationFrame(revealFrame);
  const end = performance.now() + REVEAL_MS;
  const follow = (): void => {
    if (!el.isConnected || performance.now() > end) {
      clearHighlight();
      return;
    }
    showHighlight(el);
    revealFrame = requestAnimationFrame(follow);
  };
  follow();
};
