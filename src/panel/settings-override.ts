/**
 * @license
 * Copyright 2026 oddcelot
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
  OVERRIDE_BASELINES_LS_KEY,
  SETTINGS_OVERRIDE_LS_KEY,
  type OverrideBaselines,
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

/**
 * The config values the current overrides were made against; `{}` when unset
 * or unparsable. Deliberately separate from the override itself, so the
 * runtime's apply and the live push never carry it.
 */
export const readBaselines = (): OverrideBaselines => {
  try {
    const raw = localStorage.getItem(OVERRIDE_BASELINES_LS_KEY);
    if (raw !== null) return JSON.parse(raw) as OverrideBaselines;
  } catch {
    // storage unavailable / malformed — treat as none recorded
  }
  return {};
};

const writeLocalBaselines = (baselines: OverrideBaselines | null): void => {
  try {
    if (baselines === null || Object.keys(baselines).length === 0)
      localStorage.removeItem(OVERRIDE_BASELINES_LS_KEY);
    else
      localStorage.setItem(
        OVERRIDE_BASELINES_LS_KEY,
        JSON.stringify(baselines)
      );
  } catch {
    // ignore (private mode / storage unavailable)
  }
};

/** Write the durable baselines (or delete them when empty), best-effort. */
const persistBaselines = (baselines: OverrideBaselines | undefined): void => {
  const empty = baselines === undefined || Object.keys(baselines).length === 0;
  litRpc()
    .then((rpc) =>
      empty
        ? rpc.settings.global.delete('overrideBaselines')
        : rpc.settings.global.set('overrideBaselines', baselines)
    )
    .catch(() => {
      // dev tool — ignore connection/call errors
    });
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

/**
 * A change made in this panel: all three copies, then listeners. `baselines`,
 * when given, replaces the recorded baselines (local and durable; never sent
 * to the page).
 */
export const commitOverride = (
  next: SettingsOverride,
  baselines?: OverrideBaselines
): void => {
  writeLocal(next);
  persist(next);
  if (baselines !== undefined) {
    writeLocalBaselines(baselines);
    persistBaselines(baselines);
  }
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
export const adoptOverride = (
  next: SettingsOverride,
  baselines?: OverrideBaselines
): void => {
  writeLocal(next);
  if (baselines !== undefined) writeLocalBaselines(baselines);
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
  writeLocalBaselines(null);
  persistBaselines(undefined);
  if (envValues !== undefined) pushLive(envValues);
  notify({});
};

/**
 * Drop one key from the override, leaving the rest in place. `baseline` is
 * that key's resolved config value; it goes to the live runtime alongside the
 * remaining override (a missing field would leave the current live value in
 * place) but isn't stored, so the key reads as un-overridden again.
 */
export const dropOverrideKey = <K extends keyof SettingsOverride>(
  key: K,
  baseline: SettingsOverride[K]
): void => {
  const next = {...readOverride()};
  delete next[key];
  const empty = Object.keys(next).length === 0;
  writeLocal(empty ? null : next);
  persist(empty ? undefined : next);
  const baselines = readBaselines();
  delete baselines[key as keyof OverrideBaselines];
  writeLocalBaselines(baselines);
  persistBaselines(baselines);
  pushLive({...next, [key]: baseline});
  notify(next);
};

/**
 * Re-stamp one key's baseline to the config value it has now ("Keep"), so the
 * changed-config hint goes away while the override stays.
 */
export const keepBaseline = (
  key: keyof OverrideBaselines,
  current: unknown
): void => {
  const next = {...readBaselines(), [key]: current};
  writeLocalBaselines(next);
  persistBaselines(next);
  notify(readOverride());
};
