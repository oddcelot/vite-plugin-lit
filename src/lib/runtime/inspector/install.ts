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

import {createPageScriptChannel} from 'devframe/in-page-channel';
import {elementById} from '../timeline/identity.js';
import {buildTree, collectDetails} from './collect.js';
import {clearHighlight, highlightById} from './highlight.js';
import {
  LIT_IN_PAGE_CHANNEL,
  type LitInPageProtocol,
} from '../../../types/in-page.js';
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

// The direct panel channel, outside the `hot` gate on purpose: it is the one
// part of the inspector that does not need a dev server, which is what lets
// the hover outline keep working in a static snapshot of the panel. Answering
// handshakes costs nothing until a panel actually sends one.
if (typeof window !== 'undefined') {
  const channel = createPageScriptChannel<LitInPageProtocol>({
    name: LIT_IN_PAGE_CHANNEL,
    functions: {},
    events: {
      highlight: {handler: (id) => highlightById(id)},
    },
  });
  // A panel that goes away mid-hover never gets to send its `highlight(null)`,
  // and an outline left painted over the app is worse than a missing one.
  channel.events.on('panel:disconnected', () => clearHighlight());
}

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
    // Only an *own* `updated` is stable across an HMR hot patch. A prototype
    // implementation is replaced in place on every patch (`syncOwnMembers` in
    // ../patch.ts), so caching it here would pin the watched instance to the
    // pre-edit code for the life of the watch — resolve it through the
    // prototype chain on each call instead. Our wrapper is an own property, so
    // the lookup skips it and cannot recurse.
    const ownPrev = hadOwn ? el.updated : undefined;
    const ref = new WeakRef(el);
    el.updated = function (this: Updatable, changed: unknown) {
      const current =
        ownPrev ?? (Object.getPrototypeOf(this) as Updatable | null)?.updated;
      current?.call(this, changed);
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
        if (hadOwn) cur.updated = ownPrev;
        else delete cur.updated;
      },
    };
    // Push an immediate snapshot so the panel doesn't wait for the next update.
    send({type: 'details', details: collectDetails(el)});
  };

  // -------------------------------------------------------------------------
  // Opt-in live tree: watch the DOM (light + every shadow root) and push a
  // fresh tree when the component hierarchy actually changes. Off by default.
  // childList-only (no attributes), so cosmetic changes — including our own
  // highlight box toggling — don't churn; identical rebuilds are also deduped.
  // Batches that only move text or comment nodes (most Lit re-renders) are
  // dropped before the debounce, and only added subtrees are walked for new
  // shadow roots, so a busy page no longer costs a full-page walk per batch.
  // -------------------------------------------------------------------------

  let observer: MutationObserver | null = null;
  let observeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTreeJson = '';
  // Added elements whose subtrees still need their shadow roots observed.
  let pendingRoots: Element[] = [];

  /** Observe every shadow root at or under `root` (and `root`'s subtree). */
  const observeShadowRoots = (
    obs: MutationObserver,
    root: ParentNode
  ): void => {
    if (root instanceof Element && root.shadowRoot !== null) {
      obs.observe(root.shadowRoot, {childList: true, subtree: true});
      observeShadowRoots(obs, root.shadowRoot);
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot !== null) {
        obs.observe(el.shadowRoot, {childList: true, subtree: true});
        observeShadowRoots(obs, el.shadowRoot);
      }
    }
  };

  /** Re-attach the observer to the body and every shadow root in the page. */
  const syncObserverTargets = (obs: MutationObserver): void => {
    obs.disconnect();
    obs.observe(document.body, {childList: true, subtree: true});
    observeShadowRoots(obs, document);
  };

  const pushTreeIfChanged = (): void => {
    const roots = buildTree();
    const json = JSON.stringify(roots);
    if (json === lastTreeJson) return;
    lastTreeJson = json;
    send({type: 'tree', roots});
  };

  /** Whether a subtree holds anything the tree (or observer) cares about. */
  const mayHoldComponents = (node: Node): node is Element => {
    if (!(node instanceof Element)) return false;
    const matters = (el: Element): boolean =>
      el.localName.includes('-') || el.shadowRoot !== null;
    if (matters(node)) return true;
    for (const el of node.querySelectorAll('*')) if (matters(el)) return true;
    return false;
  };

  const onMutation = (records: MutationRecord[]): void => {
    // The tree only has custom elements in it, so a batch that adds or
    // removes none (text, comments, plain markup) can't change it.
    let relevant = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (mayHoldComponents(node)) {
          pendingRoots.push(node);
          relevant = true;
        }
      }
      if (!relevant) {
        for (const node of record.removedNodes) {
          if (mayHoldComponents(node)) {
            relevant = true;
            break;
          }
        }
      }
    }
    if (!relevant) return;
    if (observeTimer !== undefined) clearTimeout(observeTimer);
    observeTimer = setTimeout(() => {
      observeTimer = undefined;
      // Walk added subtrees now rather than on arrival: a custom element
      // attaches its shadow root when it upgrades, which can be after insert.
      // Removed roots need no bookkeeping; a detached shadow root just stops
      // producing records.
      const roots = pendingRoots;
      pendingRoots = [];
      if (observer !== null) {
        for (const root of roots) {
          if (root.isConnected) observeShadowRoots(observer, root);
        }
      }
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
      pendingRoots = [];
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
      case 'highlight':
        // Fallback path. A panel that handshaked over the in-page channel
        // emits there instead and never reaches this.
        highlightById(cmd.id);
        break;
      case 'observe':
        setObserving(cmd.enabled);
        break;
    }
  });

  // Announce readiness so a panel that loaded first re-requests the tree.
  send({type: 'ready'});
}
