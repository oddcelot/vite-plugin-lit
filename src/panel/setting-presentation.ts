/**
 * How each Setting looks in the Settings tab: its row label, tooltip, and
 * how a value reads. One `format` serves the control's own text, the badge
 * naming the baseline an override replaced and the "config changed" nudge,
 * so the three can't disagree. Must cover every key in `SETTINGS`; adding a
 * Setting there without an entry here is a compile error.
 *
 * Kept out of `lib/setting-definitions.ts` because the page runtime imports
 * that, and it has no use for panel copy.
 */

import {
  SOURCE_OVERLAY_EDITORS,
  type FeatureSettings,
  type SettingsOverride,
} from '../types/timeline.js';
import type {SettingKey, SettingValue} from '../lib/setting-definitions.js';

/** What a row's hooks can look at. */
export interface SettingContext {
  /** The resolved plugin settings; `null` off the Vite plugin. */
  config: FeatureSettings | null;
  override: SettingsOverride;
}

export interface SettingPresentation<V> {
  /** Row label. */
  label: string;
  /** Row tooltip; ends with the built-in default. */
  tip: string;
  /** How a value reads. Defaults to `String`. */
  format?: (value: V) => string;
  /** A select's choices, when the Setting itself has no closed set. */
  choices?: readonly V[];
  /** Whether the row is greyed out and its control locked. */
  disabled?: (context: SettingContext) => boolean;
  /** The control's text while disabled, instead of the formatted value. */
  disabledText?: string;
  /** For a feature switch: the plugin option that turns it on. */
  option?: string;
}

const onOff = (value: boolean) => (value ? 'on' : 'off');
const shownHidden = (value: boolean) => (value ? 'shown' : 'hidden');
const enabled = (value: boolean) => (value ? 'enabled' : 'disabled');

/** An editor key's display name; a custom `EditorConfig` reads "Custom". */
export const editorLabel = (value: string): string =>
  SOURCE_OVERLAY_EDITORS.find((editor) => editor.value === value)?.label ??
  (value === 'custom' ? 'Custom' : value);

// The indicator element only exists when enabled at config time, so it can
// be hidden/shown (and its count toggled) live but not created here.
const indicatorOff = ({config}: SettingContext) =>
  config?.hmr.indicatorEnabled === false;

export const PRESENTATION = {
  hmr: {
    label: 'HMR',
    tip: 'Hot-patch Lit components in place. Default: enabled',
    format: enabled,
    option: 'hmr',
  },
  hmrReconnect: {
    label: 'reconnect',
    tip: 'Run disconnectedCallback and connectedCallback on live instances after a hot patch. Default: off',
    format: onOff,
  },
  hmrOnIncompatible: {
    label: 'on incompatible',
    tip: "What to do when a component can't be hot-patched in place: reload the page, or only warn. Default: reload",
  },
  hmrChildState: {
    label: 'child state',
    tip: 'What happens to custom elements inside an edited template: transfer hands them the old properties and private state, reuse puts the old element back where it has no bindings, reset starts them fresh. Default: transfer',
  },
  hmrIndicatorVisible: {
    label: 'indicator',
    tip: 'The dot on the page that pulses on each HMR update. Default: shown',
    format: shownHidden,
    disabled: indicatorOff,
    disabledText: 'off (config)',
  },
  hmrIndicatorCount: {
    label: 'indicator count',
    tip: 'Show a running update count next to the indicator. Default: hidden',
    format: shownHidden,
    disabled: indicatorOff,
  },
  sourceOverlay: {
    label: 'Source Overlay',
    tip: 'Click an element on the page to open its source. Default: disabled',
    format: enabled,
    option: 'sourceOverlay',
  },
  sourceOverlayEditor: {
    label: 'editor',
    tip: 'The editor that source links and the overlay open files in. Default: VS Code',
    format: editorLabel,
    choices: SOURCE_OVERLAY_EDITORS.map((editor) => editor.value),
  },
  sourceOverlayKey: {
    label: 'hotkey',
    tip: 'Toggles the source overlay on the page. Default: Ctrl+Shift+S',
    format: (key) => `Ctrl+Shift+${key.toUpperCase()}`,
  },
  sourceOverlayThrottleMs: {
    label: 'throttle (ms)',
    tip: 'Minimum time between overlay updates while the pointer moves. Default: 50',
  },
  timeline: {
    label: 'Timeline',
    tip: 'Record Lit lifecycle, render and input events. Default: disabled',
    format: enabled,
    option: 'timeline',
  },
  flashUpdates: {
    label: 'flash updates',
    tip: 'Outline elements on the page each time they update. Default: off',
    format: onOff,
  },
  flashUpdatesRamp: {
    label: 'colour by frequency',
    tip: 'Tint each flash by how often the element updates, from calm to hot, instead of one colour. Default: off',
    format: (ramp) => (ramp ? 'calm → hot' : 'single colour'),
    disabled: ({override}) => !(override.flashUpdates ?? false),
  },
  chromeTracks: {
    label: 'performance tracks',
    tip: "Mirror the timeline into the browser's performance profiler, next to its own work. Default: off",
    format: onOff,
  },
} satisfies {[K in SettingKey]: SettingPresentation<SettingValue<K>>};

/** One Setting's presentation, with its value type erased for generic use. */
export const presentationOf = (key: SettingKey): SettingPresentation<unknown> =>
  PRESENTATION[key] as SettingPresentation<unknown>;
