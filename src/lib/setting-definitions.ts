/**
 * One entry per Setting the panel shows: what it holds, its built-in default,
 * the `LIT_PLUGIN_*` env var that sets it, where its resolved value sits in
 * {@link FeatureSettings}, and how a recorded baseline compares. The override
 * and provenance types, the config -> override key map and the preference
 * defaults are all derived from here.
 *
 * Plain data with no labels: the page runtime imports this (through
 * `settings-override.ts`), so how a Setting looks in the Settings tab lives
 * in the panel (`panel/setting-presentation.ts`), which must cover every key.
 *
 * A Setting's role says what the panel can do with it:
 * - `override`: resolved from config, and replaceable live by a panel override.
 * - `preference`: a panel preference with no config value; unset means its default.
 * - `readonly`: resolved from config and shown, but not overridable.
 * - `feature`: a feature switch. Off means no runtime is injected at all, so
 *   it can only be shown, never overridden.
 *
 * Plugin options the panel never shows (`privateFields`, `cssSheetBuild`) are
 * not Settings and stay in `options.ts` alone.
 */

import type {FeatureSettings} from '../types/timeline.js';

export type SettingRole = 'override' | 'preference' | 'readonly' | 'feature';

export interface SettingDefinition<
  V = unknown,
  R extends SettingRole = SettingRole,
> {
  readonly role: R;
  /** `select` lists its {@link values}; `text`/`number` are free-form. */
  readonly kind: 'switch' | 'select' | 'text' | 'number';
  /** The closed set a `select` offers, when the type has one. */
  readonly values?: readonly V[];
  /** The built-in default, the value when neither an option nor env sets it. */
  readonly default: V;
  /** The full env var name, for every role but `preference`. */
  readonly env?: string;
  /** The resolved value in the plugin's {@link FeatureSettings}; not for `preference`. */
  readonly read?: (settings: FeatureSettings) => V;
  /**
   * Whether a recorded baseline can be compared with the current one. A value
   * that stands for something unrepresentable (a custom editor object,
   * reported as `'custom'`) can't, and never counts as moved.
   */
  readonly comparable?: (value: unknown) => boolean;
}

const define =
  <V>() =>
  <const R extends SettingRole>(
    definition: SettingDefinition<V, R>
  ): SettingDefinition<V, R> =>
    definition;

const bool = define<boolean>();
const str = define<string>();
const num = define<number>();
const oneOf = <const T extends string, const R extends SettingRole>(
  definition: SettingDefinition<T, R> & {values: readonly T[]}
): SettingDefinition<T, R> => definition;

export const SETTINGS = {
  hmr: bool({
    role: 'feature',
    kind: 'switch',
    default: true,
    env: 'LIT_PLUGIN_HMR',
    read: (s) => s.hmr.enabled,
  }),
  /**
   * Cycle `disconnectedCallback()`/`connectedCallback()` on live instances
   * after a hot patch.
   */
  hmrReconnect: bool({
    role: 'override',
    kind: 'switch',
    default: false,
    env: 'LIT_PLUGIN_HMR_RECONNECT',
    read: (s) => s.hmr.reconnect,
  }),
  /** What to do when a component can't be hot-patched in place. */
  hmrOnIncompatible: oneOf({
    role: 'override',
    kind: 'select',
    values: ['reload', 'warn'],
    default: 'reload',
    env: 'LIT_PLUGIN_HMR_ON_INCOMPATIBLE',
    read: (s) => s.hmr.onIncompatible,
  }),
  /** What happens to custom elements inside an edited template. */
  hmrChildState: oneOf({
    role: 'override',
    kind: 'select',
    values: ['transfer', 'reuse', 'reset'],
    default: 'transfer',
    env: 'LIT_PLUGIN_HMR_CHILD_STATE',
    read: (s) => s.hmr.childState,
  }),
  /**
   * Show the on-page HMR indicator. It only exists when enabled at config
   * time, so an override can hide or show it but not create it.
   */
  hmrIndicatorVisible: bool({
    role: 'override',
    kind: 'switch',
    default: true,
    env: 'LIT_PLUGIN_HMR_INDICATOR',
    read: (s) => s.hmr.indicatorEnabled,
  }),
  /** Show a running update count next to the indicator. */
  hmrIndicatorCount: bool({
    role: 'override',
    kind: 'switch',
    default: false,
    env: 'LIT_PLUGIN_HMR_INDICATOR_COUNT',
    read: (s) => s.hmr.indicatorCount,
  }),
  sourceOverlay: bool({
    role: 'feature',
    kind: 'switch',
    default: false,
    env: 'LIT_PLUGIN_SOURCE_OVERLAY',
    read: (s) => s.sourceOverlay.enabled,
  }),
  /** Built-in editor key for the source overlay's open-in-editor target. */
  sourceOverlayEditor: str({
    role: 'override',
    kind: 'select',
    default: 'vscode',
    env: 'LIT_PLUGIN_SOURCE_OVERLAY_EDITOR',
    read: (s) => s.sourceOverlay.editor,
    comparable: (value) => value !== 'custom',
  }),
  /** Hotkey letter combined with Ctrl+Shift to toggle the overlay. */
  sourceOverlayKey: str({
    role: 'readonly',
    kind: 'text',
    default: 's',
    env: 'LIT_PLUGIN_SOURCE_OVERLAY_KEY',
    read: (s) => s.sourceOverlay.key,
  }),
  sourceOverlayThrottleMs: num({
    role: 'readonly',
    kind: 'number',
    default: 50,
    env: 'LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS',
    read: (s) => s.sourceOverlay.throttleMs,
  }),
  timeline: bool({
    role: 'feature',
    kind: 'switch',
    default: false,
    env: 'LIT_PLUGIN_TIMELINE',
    read: (s) => s.timeline,
  }),
  /** Flash a short outline over every Lit element that completes an update. */
  flashUpdates: bool({role: 'preference', kind: 'switch', default: false}),
  /**
   * Colour the flash by how often the element updated in the last second,
   * calm to hot, instead of one flat colour. Only meaningful with
   * `flashUpdates`.
   */
  flashUpdatesRamp: bool({role: 'preference', kind: 'switch', default: false}),
  /**
   * Mirror the timeline into Chrome DevTools' Performance panel as custom
   * tracks (via `console.timeStamp`), independent of panel recording.
   */
  chromeTracks: bool({role: 'preference', kind: 'switch', default: false}),
} as const;

export type SettingKey = keyof typeof SETTINGS;

/** The value type a Setting holds. */
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K] extends SettingDefinition<infer V> ? V : never;

/** The Settings whose role is one of `R`. */
export type SettingKeyOf<R extends SettingRole> = {
  [K in SettingKey]: (typeof SETTINGS)[K] extends SettingDefinition<
    unknown,
    infer Role
  >
    ? Role extends R
      ? K
      : never
    : never;
}[SettingKey];

/** Settings a panel override can replace and that have a config baseline. */
export type OverridableKey = SettingKeyOf<'override'>;

/** Pure preferences: no config baseline. */
export type PreferenceKey = SettingKeyOf<'preference'>;

/** Settings the panel shows a config origin for. */
export type SourcedKey = SettingKeyOf<'override' | 'readonly' | 'feature'>;

/** Every Setting of one role, in definition order. */
export const settingsOf = <R extends SettingRole>(
  role: R
): Array<SettingKeyOf<R>> =>
  (Object.keys(SETTINGS) as SettingKey[]).filter(
    (key) => SETTINGS[key].role === role
  ) as Array<SettingKeyOf<R>>;

/**
 * Whether the config value an override was made against has since changed.
 *
 * `recorded` is `undefined` for a legacy override that predates baseline
 * tracking, which never counts as a change (no false positives). Values are
 * compared structurally, unless the Setting says one side can't be compared.
 */
export const baselineChanged = (
  key: OverridableKey,
  recorded: unknown,
  current: unknown
): boolean => {
  if (recorded === undefined || current === undefined) return false;
  const {comparable} = SETTINGS[key] as SettingDefinition;
  if (comparable && (!comparable(recorded) || !comparable(current))) {
    return false;
  }
  return JSON.stringify(recorded) !== JSON.stringify(current);
};
