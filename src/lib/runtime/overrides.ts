/**
 * Browser-runtime side of the panel's live setting overrides: the page's
 * adapter onto the shared override module. Storage is the page's own
 * `localStorage` (written by the panel; same origin), and the live port is the
 * page channel the server rebroadcasts panel changes on.
 */

import {pageChannel} from './page-channel.js';
import type {ViteHotLike} from './page-channel.js';

import {
  createSettingsOverrides,
  type SettingsOverrides,
} from '../settings-override.js';
import {
  SETTINGS_OVERRIDE_CHANNEL,
  type SettingsOverride,
} from '../../types/timeline.js';

/** `import.meta.hot` of the calling module, when it has one. */
type Hot = ViteHotLike | undefined;

let overrides: SettingsOverrides | undefined;

// Created on first use, after the caller's `hot` is attached, so the channel
// listener lands on the right carrier. The module guards every storage call,
// so a missing or throwing `localStorage` reads as no override.
const shared = (): SettingsOverrides =>
  (overrides ??= createSettingsOverrides({
    storage: {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
    },
    live: {
      listen: (cb) =>
        void pageChannel.on(SETTINGS_OVERRIDE_CHANNEL, (data) =>
          cb((data ?? {}) as SettingsOverride)
        ),
    },
  }));

/**
 * Applies the persisted override immediately, then again whenever the panel
 * pushes a change over the page channel. `apply` receives the full override
 * object each time and should act only on the fields it owns.
 */
export const subscribeOverride = (
  hot: Hot,
  apply: (override: SettingsOverride) => void
): void => {
  if (hot !== undefined) pageChannel.useViteHot(hot);
  const o = shared();
  apply(o.get());
  o.subscribe(apply);
};
