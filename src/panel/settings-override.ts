/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The panel's single owner of the {@link SettingsOverride}: what it is right
 * now, how it changes, and who wants to know.
 *
 * Three copies have to agree — `localStorage` (the app runtime reads it
 * synchronously at boot, before any DevTools connection exists), devframe's
 * per-user settings store (the durable one, survives a different browser),
 * and the live page (pushed over RPC so a loaded app reacts now). Any tab
 * that flips a preference goes through here so all three move together and
 * every other tab showing the same preference re-renders.
 */

import {
  SETTINGS_OVERRIDE_LS_KEY,
  type SettingsOverride,
} from '../types/timeline.js';
import {litRpc} from './client.js';

type Listener = (override: SettingsOverride) => void;

const listeners = new Set<Listener>();

const notify = (override: SettingsOverride): void => {
  for (const cb of listeners) cb(override);
};

/** The runtime's copy; `{}` when unset or unparsable. */
export const readOverride = (): SettingsOverride => {
  try {
    const raw = localStorage.getItem(SETTINGS_OVERRIDE_LS_KEY);
    if (raw !== null) return JSON.parse(raw) as SettingsOverride;
  } catch {
    // storage unavailable / malformed — fall through to defaults
  }
  return {};
};

const writeLocal = (override: SettingsOverride | null): void => {
  try {
    if (override === null) localStorage.removeItem(SETTINGS_OVERRIDE_LS_KEY);
    else
      localStorage.setItem(SETTINGS_OVERRIDE_LS_KEY, JSON.stringify(override));
  } catch {
    // ignore (private mode / storage unavailable)
  }
};

/** Send an override to the app runtime over RPC, best-effort. */
const pushLive = (override: SettingsOverride): void => {
  litRpc()
    .then((rpc) => rpc.rpc.call('set-settings-override', override))
    .catch(() => {
      // dev tool — ignore connection/call errors
    });
};

/** Write the durable copy (or delete it with `undefined`), best-effort. */
const persist = (override: SettingsOverride | undefined): void => {
  litRpc()
    .then((rpc) =>
      override === undefined
        ? rpc.settings.global.delete('override')
        : rpc.settings.global.set('override', override)
    )
    .catch(() => {
      // dev tool — ignore connection/call errors
    });
};

/**
 * Subscribe to override changes made anywhere in the panel. Returns the
 * unsubscribe function. Fires for every path below, not for external writes
 * to `localStorage`.
 */
export const onOverrideChange = (cb: Listener): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** A change made in this panel: all three copies, then listeners. */
export const commitOverride = (next: SettingsOverride): void => {
  writeLocal(next);
  persist(next);
  pushLive(next);
  notify(next);
};

/** Merge a few fields into the current override and commit. */
export const patchOverride = (patch: Partial<SettingsOverride>): void => {
  commitOverride({...readOverride(), ...patch});
};

/**
 * A value that arrived *from* the durable store: mirror it locally and to the
 * page, but don't write it back — that would be a pointless round trip.
 */
export const adoptOverride = (next: SettingsOverride): void => {
  writeLocal(next);
  pushLive(next);
  notify(next);
};

/**
 * Drop every override. `envValues`, when known, is pushed to the live runtime
 * so it reverts now — an empty override would leave the current live values
 * in place. Not persisted: they're the resolved config, not a preference.
 */
export const resetOverride = (envValues?: SettingsOverride): void => {
  writeLocal(null);
  persist(undefined);
  if (envValues !== undefined) pushLive(envValues);
  notify({});
};
