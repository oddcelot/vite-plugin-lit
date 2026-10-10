/**
 * What one Settings row shows, worked out as plain data: the effective
 * value, where it came from, whether a panel override replaced it and with
 * what baseline, whether that baseline has since moved, and the markers on a
 * select's options. The template in `devtools-settings.ts` only lays it out,
 * so every rule here is tested without a DOM.
 */

import {
  SETTINGS,
  baselineChanged,
  type OverridableKey,
  type SettingDefinition,
  type SettingKey,
} from '../lib/setting-definitions.js';
import type {
  OverrideBaselines,
  SettingSource,
  SettingSources,
} from '../types/timeline.js';
import {presentationOf, type SettingContext} from './setting-presentation.js';

export interface SettingRowContext extends SettingContext {
  /** The config values the current overrides were made against. */
  recorded: OverrideBaselines;
}

export interface SettingOption {
  value: unknown;
  text: string;
  /**
   * Trails the option in the open list: the config value names where it
   * came from, and when that was env or an option, the built-in default
   * gets its own `default` marker, so the list shows both.
   */
  marker?: SettingSource;
}

export interface SettingRow {
  key: SettingKey;
  definition: SettingDefinition;
  label: string;
  tip: string;
  /** The value in effect: the override, else the config value, else the default. */
  value: unknown;
  /** The control's text. */
  text: string;
  /**
   * Where the config value came from, for the origin badge. Absent for a
   * preference (no config value) and when the server sent no provenance.
   */
  origin?: SettingSource;
  /** Set when a panel override replaces the config value. */
  override?: {
    /** Names the replaced value's layer; `config` without provenance. */
    source: SettingSource | 'config';
    /** The replaced config value, as the row formats it. */
    baseline: string;
    /** Set when the config value moved since the override was made. */
    moved?: {was: string; now: string};
  };
  disabled: boolean;
  /** A select's choices, in order. */
  options?: SettingOption[];
}

const sourced = (key: SettingKey): key is keyof SettingSources =>
  SETTINGS[key].role !== 'preference';

const holdsOwn = (role: SettingDefinition['role']): boolean =>
  role === 'override' || role === 'preference';

/** Which layer a select choice came from: the config's, or the default. */
const markerOf = (
  choice: unknown,
  configValue: unknown,
  fallback: unknown,
  origin: SettingSource | undefined
): SettingSource | undefined => {
  if (choice === configValue) return origin ?? 'default';
  return choice === fallback ? 'default' : undefined;
};

/** A select's choices with their markers; undefined for any other row. */
const optionsOf = (
  definition: SettingDefinition,
  presentation: ReturnType<typeof presentationOf>,
  configValue: unknown,
  origin: SettingSource | undefined
): SettingOption[] | undefined => {
  const choices = definition.values ?? presentation.choices;
  if (definition.kind !== 'select' || !choices) return undefined;
  const format = presentation.format ?? String;
  return choices.map((choice) => ({
    value: choice,
    text: format(choice),
    marker: markerOf(choice, configValue, definition.default, origin),
  }));
};

export const settingRow = (
  key: SettingKey,
  context: SettingRowContext
): SettingRow => {
  const definition: SettingDefinition = SETTINGS[key];
  const presentation = presentationOf(key);
  const format = presentation.format ?? String;
  const {config, override, recorded} = context;

  const configValue = config === null ? undefined : definition.read?.(config);
  // Only overrides and preferences live in the override; the rest are
  // config-only.
  const own = holdsOwn(definition.role)
    ? (override as Record<string, unknown>)[key]
    : undefined;
  const overridden = definition.role === 'override' && own !== undefined;
  const value = own ?? configValue ?? definition.default;
  const origin = sourced(key) ? config?.sources?.[key] : undefined;
  const disabled = presentation.disabled?.(context) ?? false;

  const row: SettingRow = {
    key,
    definition,
    label: presentation.label,
    tip: presentation.tip,
    value,
    text: disabled
      ? (presentation.disabledText ?? format(value))
      : format(value),
    origin,
    disabled,
  };

  if (overridden) {
    const baseline = format(configValue ?? definition.default);
    const was = recorded[key as OverridableKey];
    row.override = {
      source: origin ?? 'config',
      baseline,
      moved: baselineChanged(key as OverridableKey, was, configValue)
        ? {was: format(was), now: baseline}
        : undefined,
    };
  }

  const options = optionsOf(definition, presentation, configValue, origin);
  if (options) row.options = options;
  return row;
};
