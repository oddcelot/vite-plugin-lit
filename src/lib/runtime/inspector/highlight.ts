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
  const r = el.getBoundingClientRect();
  Object.assign(ensureBox().style, {
    display: 'block',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
};

/** Hide the outline. Cheap and safe before the box has ever been built. */
export const clearHighlight = (): void => {
  if (box !== null) box.style.display = 'none';
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
