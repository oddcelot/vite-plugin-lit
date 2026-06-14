/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Browser-runtime side of the panel's live setting overrides. Reads the
 * persisted override (written by the panel; same origin) and subscribes to the
 * Vite HMR channel the server rebroadcasts panel changes on.
 */

import {
  SETTINGS_OVERRIDE_CHANNEL,
  SETTINGS_OVERRIDE_LS_KEY,
  type SettingsOverride,
} from '../../types/timeline.js';

/** Minimal `import.meta.hot` shape we rely on. */
type Hot =
  | {on: (event: string, cb: (data: unknown) => void) => void}
  | undefined;

/** Reads the persisted override; `{}` when unset or unparsable. */
export const readOverride = (): SettingsOverride => {
  try {
    const raw = localStorage.getItem(SETTINGS_OVERRIDE_LS_KEY);
    if (raw !== null) return JSON.parse(raw) as SettingsOverride;
  } catch {
    // storage unavailable / malformed — fall through to defaults
  }
  return {};
};

/**
 * Applies the persisted override immediately, then again whenever the panel
 * pushes a change over the HMR channel. `apply` receives the full override
 * object each time and should act only on the fields it owns.
 */
export const subscribeOverride = (
  hot: Hot,
  apply: (override: SettingsOverride) => void
): void => {
  apply(readOverride());
  hot?.on(SETTINGS_OVERRIDE_CHANNEL, (data) =>
    apply((data ?? {}) as SettingsOverride)
  );
};
