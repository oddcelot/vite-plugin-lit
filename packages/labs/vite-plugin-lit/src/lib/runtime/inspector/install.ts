/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Components inspector runtime.
 *
 * Injected into the host page (alongside the timeline runtime) when the
 * DevTools panel is enabled. Answers the panel's tree/details requests over the
 * Vite HMR channel, keeps a watched element's details fresh as it updates, and
 * outlines elements the panel hovers in its tree.
 */

import {elementById} from '../timeline/identity.js';
import {buildTree, collectDetails} from './collect.js';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  type InspectorCommand,
  type InspectorMessage,
} from '../../../types/inspector.js';

type ViteHot = {
  send: (event: string, data: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => void;
};

const hot = (import.meta as {hot?: ViteHot}).hot;

if (hot !== undefined && typeof window !== 'undefined') {
  const send = (msg: InspectorMessage): void => {
    try {
      hot.send(INSPECT_DATA_CHANNEL, msg);
    } catch {
      // HMR channel temporarily unavailable; the panel can re-request.
    }
  };

  // -------------------------------------------------------------------------
  // Live-watch: re-push details whenever the watched element finishes updating.
  // We wrap the instance's `updated` (not the prototype) so the hook is scoped
  // to one element and trivially removable, and it works without the timeline's
  // recording gate.
  // -------------------------------------------------------------------------

  type Updatable = Element & {
    updated?: (changed: unknown) => void;
  };
  // Hold the watched element via a WeakRef so an active watch doesn't keep a
  // removed element alive: the override and `restore` only reach `el` through
  // the ref, leaving the DOM as its sole strong root.
  let watched: {ref: WeakRef<Updatable>; restore: () => void} | null = null;

  const unwatch = (): void => {
    watched?.restore();
    watched = null;
  };

  const watch = (id: number): void => {
    unwatch();
    const el = elementById(id) as Updatable | undefined;
    if (el === undefined) {
      send({type: 'gone', id});
      return;
    }
    const hadOwn = Object.prototype.hasOwnProperty.call(el, 'updated');
    const prev = el.updated;
    const ref = new WeakRef(el);
    el.updated = function (changed: unknown) {
      prev?.call(this, changed);
      const cur = ref.deref();
      if (cur !== undefined) {
        send({type: 'details', details: collectDetails(cur)});
      }
    };
    watched = {
      ref,
      restore: () => {
        const cur = ref.deref();
        if (cur === undefined) return;
        if (hadOwn) cur.updated = prev;
        else delete cur.updated;
      },
    };
    // Push an immediate snapshot so the panel doesn't wait for the next update.
    send({type: 'details', details: collectDetails(el)});
  };

  // -------------------------------------------------------------------------
  // Highlight box: a lightweight fixed-position outline drawn over an element
  // the panel hovers in its tree. Independent of the source overlay so it works
  // whether or not that feature is enabled.
  // -------------------------------------------------------------------------

  let highlightBox: HTMLElement | null = null;

  const showHighlight = (el: Element): void => {
    if (highlightBox === null) {
      highlightBox = document.createElement('div');
      highlightBox.setAttribute('data-lit-devtools-highlight', '');
      Object.assign(highlightBox.style, {
        position: 'fixed',
        zIndex: '2147483646',
        pointerEvents: 'none',
        background: 'rgba(77, 99, 255, 0.25)',
        outline: '1px solid #4d63ff',
        borderRadius: '2px',
        transition: 'all 80ms ease-out',
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.append(highlightBox);
    }
    const r = el.getBoundingClientRect();
    Object.assign(highlightBox.style, {
      display: 'block',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  };

  const clearHighlight = (): void => {
    if (highlightBox !== null) highlightBox.style.display = 'none';
  };

  // -------------------------------------------------------------------------
  // Opt-in live tree: watch the DOM (light + every shadow root) and push a
  // fresh tree when the component hierarchy actually changes. Off by default.
  // childList-only (no attributes), so cosmetic changes — including our own
  // highlight box toggling — don't churn; identical rebuilds are also deduped.
  // -------------------------------------------------------------------------

  let observer: MutationObserver | null = null;
  let observeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTreeJson = '';

  /** Re-attach the observer to the body and every shadow root in the page. */
  const syncObserverTargets = (obs: MutationObserver): void => {
    obs.disconnect();
    obs.observe(document.body, {childList: true, subtree: true});
    const walk = (root: ParentNode): void => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot !== null) {
          obs.observe(el.shadowRoot, {childList: true, subtree: true});
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
  };

  const pushTreeIfChanged = (): void => {
    const roots = buildTree();
    const json = JSON.stringify(roots);
    if (json === lastTreeJson) return;
    lastTreeJson = json;
    send({type: 'tree', roots});
  };

  const onMutation = (): void => {
    if (observeTimer !== undefined) clearTimeout(observeTimer);
    observeTimer = setTimeout(() => {
      observeTimer = undefined;
      if (observer !== null) syncObserverTargets(observer);
      pushTreeIfChanged();
    }, 100);
  };

  const setObserving = (enabled: boolean): void => {
    if (enabled) {
      if (observer === null) observer = new MutationObserver(onMutation);
      lastTreeJson = '';
      syncObserverTargets(observer);
      pushTreeIfChanged();
    } else if (observer !== null) {
      observer.disconnect();
      observer = null;
      if (observeTimer !== undefined) {
        clearTimeout(observeTimer);
        observeTimer = undefined;
      }
    }
  };

  // -------------------------------------------------------------------------
  // SPA navigation: a route change swaps the component tree without any HMR
  // or panel event, so the snapshot went stale until a manual refresh. Push a
  // deduped tree after each navigation — twice, since routes typically
  // lazy-load and render async. Redundant while the live observer watches.
  // -------------------------------------------------------------------------

  const onNavigation = (): void => {
    if (observer !== null) return;
    for (const delay of [150, 1000]) {
      setTimeout(pushTreeIfChanged, delay);
    }
  };
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      onNavigation();
    };
  }

  // -------------------------------------------------------------------------
  // Command dispatch
  // -------------------------------------------------------------------------

  hot.on(INSPECT_CMD_CHANNEL, (data) => {
    const cmd = data as InspectorCommand;
    switch (cmd.type) {
      case 'tree': {
        const roots = buildTree();
        lastTreeJson = JSON.stringify(roots);
        send({type: 'tree', roots});
        break;
      }
      case 'details': {
        const el = elementById(cmd.id);
        if (el !== undefined) {
          send({type: 'details', details: collectDetails(el)});
        } else {
          send({type: 'gone', id: cmd.id});
        }
        break;
      }
      case 'watch':
        if (cmd.id === null) unwatch();
        else watch(cmd.id);
        break;
      case 'highlight': {
        if (cmd.id === null) {
          clearHighlight();
          break;
        }
        const el = elementById(cmd.id);
        if (el !== undefined) showHighlight(el);
        else clearHighlight();
        break;
      }
      case 'observe':
        setObserving(cmd.enabled);
        break;
    }
  });

  // Announce readiness so a panel that loaded first re-requests the tree.
  send({type: 'ready'});
}
