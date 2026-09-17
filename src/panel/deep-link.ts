/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Addressing a specific view inside the panel.
 *
 * Two arrival paths, because the panel runs in two quite different places:
 *
 *  - **Inside the DevTools hub.** Anything holding an RPC client — another
 *    devframe, a command, this plugin's own node side when the page overlay
 *    picks an element — calls `hub:docks:activate` with `{dockId, params}`.
 *    The hub mirrors the request into the `devframe:docks:active` shared
 *    state, so a panel that mounts *because of* the activation still sees it
 *    instead of missing a live broadcast.
 *  - **Standalone, or as an exported snapshot.** There is no hub; the URL is
 *    the only carrier. Devframe's guidance is the hash, not the query string,
 *    since the query is where handshake tokens live and those must not travel
 *    in a link someone pastes into an issue.
 *
 * Both collapse to the same {@link DeepLink}, so callers handle one shape.
 */

import {litRpc} from './client.js';

/** The hub's mirrored activation slot. */
const DOCKS_ACTIVE_STATE = 'devframe:docks:active';

/** Our dock id, as the hub knows it. */
const LIT_DOCK_ID = 'lit';

/**
 * Tabs a link can name. A value rather than a bare union because the same list
 * is validated in two places and cast in a third; adding a view should not
 * mean remembering all of them.
 */
export const DEEP_LINK_TABS = [
  'components',
  'updates',
  'timeline',
  'settings',
] as const;

export type DeepLinkTab = (typeof DEEP_LINK_TABS)[number];

const isTab = (value: unknown): value is DeepLinkTab =>
  typeof value === 'string' &&
  (DEEP_LINK_TABS as readonly string[]).includes(value);

/** A resolved link into the panel. Every field is optional and additive. */
export interface DeepLink {
  /** Which tab to show. */
  tab?: DeepLinkTab;
  /** Element to select, by stable id: a node in the Components tree, or the
   *  component row it belongs to in Updates. */
  componentId?: number;
}

/** Parse a `DeepLink` out of hash params, ignoring anything unrecognised. */
const fromParams = (params: URLSearchParams): DeepLink => {
  const link: DeepLink = {};
  const tab = params.get('tab');
  if (isTab(tab)) {
    link.tab = tab;
  }
  const id = Number(params.get('component'));
  // `Number('')` is 0 and `Number(null)` is 0, so require the param to be
  // there *and* numeric before trusting it — id 0 is a real element id.
  if (params.get('component') !== null && Number.isInteger(id)) {
    link.componentId = id;
  }
  return link;
};

/** Read the link encoded in the current URL hash, if any. */
export const readHashLink = (): DeepLink =>
  fromParams(new URLSearchParams(location.hash.replace(/^#/, '')));

/**
 * Reflect the panel's current position into the URL hash, so copying the
 * address bar produces a link that reopens it.
 *
 * `replaceState`, not `pushState`: clicking through a component tree is
 * browsing one view, not navigating between pages, and stacking a history
 * entry per click would turn Back into a frustration. Merges into whatever
 * else is in the hash rather than overwriting it.
 */
export const writeHashLink = (link: DeepLink): void => {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (link.tab === undefined) params.delete('tab');
  else params.set('tab', link.tab);
  if (link.componentId === undefined) params.delete('component');
  else params.set('component', String(link.componentId));
  const next = params.toString();
  if (next === location.hash.replace(/^#/, '')) return;
  history.replaceState(
    history.state,
    '',
    next === '' ? location.pathname : `#${next}`
  );
};

/**
 * Call `apply` for every link addressed at this panel: once for the URL hash
 * the panel opened with, then again whenever the hub activates our dock with
 * params, and on manual hash edits / back-forward.
 *
 * Never throws. Deep links are a convenience; a panel with no hub (or an
 * older one with no activation state) simply keeps the hash path.
 */
export const onDeepLink = (apply: (link: DeepLink) => void): void => {
  const hashLink = readHashLink();
  if (hashLink.tab !== undefined || hashLink.componentId !== undefined) {
    apply(hashLink);
  }
  window.addEventListener('hashchange', () => apply(readHashLink()));

  void (async () => {
    try {
      const client = await litRpc();
      const state = await client.base.sharedState.get<{
        activation: {dockId: string; params?: Record<string, unknown>} | null;
      }>(DOCKS_ACTIVE_STATE);
      const handle = (value: {
        activation: {dockId: string; params?: Record<string, unknown>} | null;
      }): void => {
        const activation = value.activation;
        if (activation === null || activation.dockId !== LIT_DOCK_ID) return;
        const params = activation.params;
        if (params === undefined) return;
        const link: DeepLink = {};
        const tab = params['tab'];
        if (isTab(tab)) {
          link.tab = tab;
        }
        const id = params['componentId'];
        if (typeof id === 'number' && Number.isInteger(id)) {
          link.componentId = id;
        }
        if (link.tab !== undefined || link.componentId !== undefined) {
          apply(link);
        }
      };
      handle(state.value());
      state.on('updated', handle);
    } catch {
      // No hub, or no activation slot — the hash path above still works.
    }
  })();
};
