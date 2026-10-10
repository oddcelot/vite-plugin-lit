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

import {
  formatRangeParam,
  normalizeRange,
  parseRangeParam,
} from '../lib/timeline/range.js';
import type {TimeRange} from '../lib/timeline/range.js';
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
  /** Timeline event to select, by the id the node side stamped on it (see
   *  `TimelineEvent.id`). Survives a snapshot export, unlike a buffer index. */
  eventId?: string;
  /** Time range to select in the Timeline, in milliseconds on the recording
   *  buffer's clock. That clock restarts with each recording, so a range means
   *  something only against the recording it was copied from: a snapshot, or
   *  a live session before it is cleared. */
  range?: TimeRange;
}

/** True when a link asks for anything at all. */
const hasLink = (link: DeepLink): boolean =>
  link.tab !== undefined ||
  link.componentId !== undefined ||
  link.eventId !== undefined ||
  link.range !== undefined;

/** Parse a `DeepLink` out of hash params, ignoring anything unrecognised. */
export const fromParams = (params: URLSearchParams): DeepLink => {
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
  const eventId = params.get('event');
  if (eventId !== null && eventId !== '') link.eventId = eventId;
  const range = parseRangeParam(params.get('range') ?? '');
  if (range !== null) link.range = range;
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
  if (link.eventId === undefined) params.delete('event');
  else params.set('event', link.eventId);
  if (link.range === undefined) params.delete('range');
  else params.set('range', formatRangeParam(link.range));
  const next = params.toString();
  if (next === location.hash.replace(/^#/, '')) return;
  history.replaceState(
    history.state,
    '',
    // Keep the query: the extension's panel page can be addressed by one.
    next === '' ? location.pathname + location.search : `#${next}`
  );
};

/**
 * The address of the panel as it is now, opened at `link`: this page's URL
 * with its hash replaced, so it carries nothing but the link.
 */
export const linkHref = (link: DeepLink): string => {
  const params = new URLSearchParams();
  if (link.tab !== undefined) params.set('tab', link.tab);
  if (link.componentId !== undefined) {
    params.set('component', String(link.componentId));
  }
  if (link.eventId !== undefined) params.set('event', link.eventId);
  if (link.range !== undefined)
    params.set('range', formatRangeParam(link.range));
  return `${location.origin}${location.pathname}${location.search}#${params}`;
};

/** The link an activation's `params` address; fields that don't parse are dropped. */
const linkFromParams = (params: Record<string, unknown>): DeepLink => {
  const link: DeepLink = {};
  const tab = params['tab'];
  if (isTab(tab)) link.tab = tab;
  const id = params['componentId'];
  if (typeof id === 'number' && Number.isInteger(id)) link.componentId = id;
  const eventId = params['eventId'];
  if (typeof eventId === 'string' && eventId !== '') link.eventId = eventId;
  const range = params['range'];
  if (typeof range === 'object' && range !== null) {
    const {start, end} = range as Record<string, unknown>;
    const parsed =
      typeof start === 'number' && typeof end === 'number'
        ? normalizeRange(start, end)
        : null;
    if (parsed !== null) link.range = parsed;
  }
  return link;
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
  if (hasLink(hashLink)) apply(hashLink);
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
        const link = linkFromParams(params);
        if (hasLink(link)) apply(link);
      };
      handle(state.value());
      state.on('updated', handle);
    } catch {
      // No hub, or no activation slot — the hash path above still works.
    }
  })();
};
