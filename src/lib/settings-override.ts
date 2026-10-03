/**
 * The one owner of the {@link SettingsOverride}: what it is, how it changes,
 * who hears about it, and how it reverts to the resolved config.
 *
 * Both the panel bundle and the page runtime import this file, so it is
 * plain TypeScript: no Vite, no DOM, no panel UI. Everything environmental
 * comes in through ports ({@link OverrideStorage}, {@link LivePort},
 * {@link DurablePort}); the module owns the rest: the `localStorage` keys and
 * their JSON, baseline capture, the config -> override key map, the
 * hydrate/adopt loop guard and reset-to-env.
 *
 * Adding an overridable setting or a pure preference means adding its entry
 * to `SETTINGS` in `setting-definitions.ts`; the key map and the defaults
 * here are derived from it.
 *
 * The panel's color scheme rides along: it is not part of the override (the
 * page never sees it), but it is stored, persisted and adopted the same way,
 * so it goes through the same loop guard.
 */

import {
  OVERRIDE_BASELINES_LS_KEY,
  SETTINGS_OVERRIDE_LS_KEY,
  type FeatureSettings,
  type SettingsOverride,
} from '../types/timeline.js';
import {
  SETTINGS,
  settingsOf,
  type OverridableKey,
  type PreferenceKey,
  type SettingValue,
} from './setting-definitions.js';

/**
 * Overridable settings that have a config baseline: each reads the resolved
 * value out of the plugin's {@link FeatureSettings}. The config -> override
 * key map, derived from the Setting definitions.
 */
export const CONFIG_KEYS = Object.fromEntries(
  settingsOf('override').map((key) => [key, SETTINGS[key].read])
) as {[K in OverridableKey]: (s: FeatureSettings) => SettingValue<K>};

export type {OverridableKey};

/**
 * Pure preferences: no config-time baseline, so they revert to these when
 * the overrides are reset.
 */
export const PREFERENCE_DEFAULTS = Object.fromEntries(
  settingsOf('preference').map((key) => [key, SETTINGS[key].default])
) as {[K in PreferenceKey]: SettingValue<K>};

/**
 * The resolved config value each overridden key was set against, recorded so
 * the Settings tab can notice when `.env` or plugin options moved on. Kept
 * beside the {@link SettingsOverride}, never inside it: the runtime applies
 * and receives the override as-is and has no use for these.
 */
export type OverrideBaselines = Partial<Record<OverridableKey, unknown>>;

/** The resolved config value of every overridable setting. */
export const configValues = (
  config: FeatureSettings
): Required<Pick<SettingsOverride, OverridableKey>> => {
  const out: Record<string, unknown> = {};
  for (const [key, read] of Object.entries(CONFIG_KEYS))
    out[key] = read(config);
  return out as Required<Pick<SettingsOverride, OverridableKey>>;
};

/** The pure preferences of an override, each its default when unset. */
export const preferences = (
  o: SettingsOverride
): Record<PreferenceKey, boolean> => {
  const out = {...PREFERENCE_DEFAULTS} as Record<PreferenceKey, boolean>;
  for (const key of Object.keys(out) as PreferenceKey[]) {
    out[key] = o[key] ?? out[key];
  }
  return out;
};

/** The panel's color scheme; `auto` follows the host. */
export type ColorSchemePreference = 'auto' | 'dark' | 'light';

/** localStorage key for the {@link ColorSchemePreference}. */
export const COLOR_SCHEME_LS_KEY = 'lit-devtools-color-scheme';

/** A stored color scheme, or `auto` for anything unrecognised. */
export const parseColorScheme = (raw: unknown): ColorSchemePreference =>
  raw === 'dark' || raw === 'light' ? raw : 'auto';

/** The slice of `Storage` the module needs; `localStorage` satisfies it. */
export type OverrideStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

/**
 * The live channel to the running page. `push` sends an override out (the
 * panel's RPC); `listen` receives one (the page runtime's channel). Either may
 * be absent: the panel never listens, the runtime never pushes. Best-effort.
 */
export interface LivePort {
  push?(override: SettingsOverride): void;
  listen?(cb: (override: SettingsOverride) => void): void;
}

/** The durable per-user store (devframe's settings). Best-effort. */
export interface DurablePort {
  set(key: 'override', value: SettingsOverride): void;
  set(key: 'overrideBaselines', value: OverrideBaselines): void;
  set(key: 'appearance', value: ColorSchemePreference): void;
  delete(key: 'override' | 'overrideBaselines'): void;
}

export interface OverridePorts {
  storage: OverrideStorage;
  live?: LivePort;
  durable?: DurablePort;
  /** Applies a color scheme to the panel; the page has none to apply. */
  readonly applyAppearance?: (scheme: ColorSchemePreference) => void;
}

/** A snapshot from the durable store, as `adopt` receives it. */
export interface DurableSnapshot {
  override?: SettingsOverride;
  overrideBaselines?: OverrideBaselines;
  appearance?: ColorSchemePreference;
}

export interface SettingsOverrides {
  /** The current override; `{}` when unset or unparsable. */
  get(): SettingsOverride;
  /** The config values the current overrides were made against; `{}` if none. */
  baselines(): OverrideBaselines;
  /**
   * Change one setting: local, durable and live copies, then subscribers. For
   * a key with a config baseline and a `config`, the baseline is recorded too
   * (local and durable; never sent live).
   */
  set<K extends keyof SettingsOverride>(
    key: K,
    value: SettingsOverride[K],
    config?: FeatureSettings
  ): void;
  /**
   * Drop every override. With `config`, the resolved values (and preference
   * defaults) are pushed live so the page reverts now.
   */
  reset(config?: FeatureSettings): void;
  /** Drop one key, reverting it live to its config value. */
  resetKey(key: OverridableKey, config: FeatureSettings): void;
  /** Re-stamp one key's baseline to the config value it has now ("Keep"). */
  keep(key: OverridableKey, config: FeatureSettings): void;
  /** The panel's color scheme; `auto` when unset. */
  appearance(): ColorSchemePreference;
  /** Change the color scheme: local and durable copies, then apply it. */
  setAppearance(scheme: ColorSchemePreference): void;
  /**
   * A snapshot that arrived from the durable store: mirror it locally (and the
   * override live) without writing it back. A no-op (returns `false`) when it
   * already matches, which is what stops adopt -> store write -> onChange ->
   * adopt looping.
   */
  adopt(snapshot: DurableSnapshot): boolean;
  /**
   * Fires with the override after every change made through this module, and
   * with whatever the live port delivers. Not for external storage writes.
   * Returns the unsubscribe function.
   */
  subscribe(cb: (override: SettingsOverride) => void): () => void;
}

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const isEmpty = (o: object | undefined): boolean =>
  o === undefined || Object.keys(o).length === 0;

export const createSettingsOverrides = (
  ports: OverridePorts
): SettingsOverrides => {
  const {storage, live, durable, applyAppearance} = ports;
  const listeners = new Set<(override: SettingsOverride) => void>();

  const notify = (override: SettingsOverride): void => {
    for (const cb of listeners) cb(override);
  };

  const read = <T extends object>(key: string): T => {
    try {
      const raw = storage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // storage unavailable / malformed — treat as none recorded
    }
    return {} as T;
  };

  const write = (key: string, value: object | null): void => {
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore (private mode / storage unavailable)
    }
  };

  const get = (): SettingsOverride =>
    read<SettingsOverride>(SETTINGS_OVERRIDE_LS_KEY);
  const baselines = (): OverrideBaselines =>
    read<OverrideBaselines>(OVERRIDE_BASELINES_LS_KEY);

  const writeOverride = (o: SettingsOverride | undefined): void =>
    write(SETTINGS_OVERRIDE_LS_KEY, o ?? null);
  const writeBaselines = (b: OverrideBaselines | undefined): void =>
    write(OVERRIDE_BASELINES_LS_KEY, isEmpty(b) ? null : (b ?? null));

  const persistOverride = (o: SettingsOverride | undefined): void => {
    if (o === undefined) durable?.delete('override');
    else durable?.set('override', o);
  };
  const persistBaselines = (b: OverrideBaselines | undefined): void => {
    if (b === undefined || isEmpty(b)) durable?.delete('overrideBaselines');
    else durable?.set('overrideBaselines', b);
  };

  const appearance = (): ColorSchemePreference => {
    try {
      return parseColorScheme(storage.getItem(COLOR_SCHEME_LS_KEY));
    } catch {
      return 'auto';
    }
  };
  const writeAppearance = (scheme: ColorSchemePreference): void => {
    try {
      storage.setItem(COLOR_SCHEME_LS_KEY, scheme);
    } catch {
      // ignore (private mode / storage unavailable)
    }
    applyAppearance?.(scheme);
  };

  live?.listen?.((o) => notify(o ?? {}));

  return {
    get,
    baselines,

    set(key, value, config) {
      const next = {...get(), [key]: value};
      let recorded: OverrideBaselines | undefined;
      if (config !== undefined && key in CONFIG_KEYS) {
        const k = key as unknown as OverridableKey;
        recorded = {...baselines(), [k]: CONFIG_KEYS[k](config)};
      }
      writeOverride(next);
      persistOverride(next);
      if (recorded !== undefined) {
        writeBaselines(recorded);
        persistBaselines(recorded);
      }
      live?.push?.(next);
      notify(next);
    },

    reset(config) {
      writeOverride(undefined);
      persistOverride(undefined);
      writeBaselines(undefined);
      persistBaselines(undefined);
      if (config !== undefined) {
        live?.push?.({...configValues(config), ...PREFERENCE_DEFAULTS});
      }
      notify({});
    },

    resetKey(key, config) {
      const next = {...get()};
      delete next[key];
      const empty = isEmpty(next);
      writeOverride(empty ? undefined : next);
      persistOverride(empty ? undefined : next);
      const recorded = baselines();
      delete recorded[key];
      writeBaselines(recorded);
      persistBaselines(recorded);
      live?.push?.({...next, [key]: CONFIG_KEYS[key](config)});
      notify(next);
    },

    keep(key, config) {
      const next = {...baselines(), [key]: CONFIG_KEYS[key](config)};
      writeBaselines(next);
      persistBaselines(next);
      notify(get());
    },

    appearance,

    setAppearance(scheme) {
      writeAppearance(scheme);
      durable?.set('appearance', scheme);
    },

    adopt({override, overrideBaselines, appearance: scheme}) {
      let changed = false;
      if (scheme !== undefined && scheme !== appearance()) {
        writeAppearance(scheme);
        changed = true;
      }
      if (override === undefined) return changed;
      const recorded = overrideBaselines ?? {};
      if (sameJson(override, get()) && sameJson(recorded, baselines())) {
        return changed;
      }
      writeOverride(override);
      writeBaselines(recorded);
      live?.push?.(override);
      notify(override);
      return true;
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
};
