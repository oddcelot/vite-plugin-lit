/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {SOURCE_META_KEY, type LitSourceMeta} from '../source-meta.js';
import type {ElementInfo} from '../../types.js';

export interface ElementResolver {
  resolveElementInfo(el: Element): Promise<ElementInfo | null>;
}

// Walk up from an element (crossing shadow boundaries) to the nearest host that
// carries Lit source metadata, i.e. the component that rendered it.
export const findSourceHost = (el: Element): Element | null => {
  let current: Element | null = el;
  while (current !== null) {
    const ctor = current.constructor as CustomElementConstructor & {
      [SOURCE_META_KEY]?: LitSourceMeta;
    };
    if (ctor[SOURCE_META_KEY] !== undefined) {
      return current;
    }
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      current = root.host;
      continue;
    }
    current = current.parentElement;
  }
  return null;
};

// Pierce nested shadow roots to find the deepest element under the cursor.
// document.elementFromPoint retargets shadow content to the top-level host, so
// we descend through each shadowRoot to reach the innermost element.
export const deepElementFromPoint = (x: number, y: number): Element | null => {
  let el = document.elementFromPoint(x, y);
  let deepest: Element | null = el;
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (inner === null || inner === el) break;
    deepest = inner;
    el = inner;
  }
  return deepest;
};

// Resolve the source host under a viewport point. The optional dialog is the
// overlay's own modal, temporarily closed so it doesn't shadow the hit-test.
export const findSourceAtPoint = (
  x: number,
  y: number,
  dialog: HTMLDialogElement | null = null
): Element | null => {
  if (dialog !== null) dialog.close();
  try {
    const deepest = deepElementFromPoint(x, y);
    if (deepest !== null) {
      const host = findSourceHost(deepest);
      if (host !== null) return host;
    }

    // Bounding-rect fallback for elements elementFromPoint misses — prefer the
    // deepest matching host so nested components still beat their ancestors.
    let best: Element | null = null;
    for (const el of document.querySelectorAll('*')) {
      const ctor = el.constructor as CustomElementConstructor & {
        [SOURCE_META_KEY]?: LitSourceMeta;
      };
      if (ctor[SOURCE_META_KEY] === undefined) continue;
      const rect = el.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        if (best === null || best.contains(el)) best = el;
      }
    }
    return best;
  } finally {
    if (dialog !== null && !dialog.open) dialog.showModal();
  }
};

export const defaultResolver: ElementResolver = {
  async resolveElementInfo(el) {
    const host = findSourceHost(el);
    if (host === null) return null;
    const ctor = host.constructor as CustomElementConstructor & {
      [SOURCE_META_KEY]?: LitSourceMeta;
    };
    const meta = ctor[SOURCE_META_KEY];
    if (meta === undefined) return null;
    return {
      tagName: host.tagName.toLowerCase(),
      componentName: meta.componentName,
      source: {
        filePath: meta.filePath,
        lineNumber: meta.lineNumber,
      },
    };
  },
};
