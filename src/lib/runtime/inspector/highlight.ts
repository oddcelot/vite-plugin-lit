/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

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
