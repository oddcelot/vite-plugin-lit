/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

export interface TimelineLayer {
  id: string;
  label: string;
  color: number; // 0xRRGGBB
}

export interface TimelineEvent<TData = unknown> {
  /**
   * Stable identity, stamped on the Node side (`${epoch}-${seq}`) when the
   * event is received, so it survives the stream, `recent-events` and a
   * snapshot export. Absent on events still in the page runtime.
   */
  id?: string;
  layerId: string;
  /**
   * Milliseconds since recording started, stamped in the browser page
   * (`performance.now()` re-zeroed on each recording start; see
   * `runtime/timeline/clock.ts`). Not comparable to any Node-side clock.
   */
  time: number;
  data: TData;
  title?: string;
  subtitle?: string;
  /** Pairs a start event with its matching end event in the same update group. */
  groupId?: number | string;
  logType?: 'default' | 'warning' | 'error';
  meta?: {
    elementId?: number;
    tagName?: string;
    source?: {file: string; line: number};
  };
}

export interface TimelineLayersState {
  recordingState: boolean;
  litLifecycleEnabled: boolean;
  litRenderEnabled: boolean;
  /**
   * Per-part `lit-debug` events (`template updating`, `set part`, `commit
   * *`, …) — one per binding on *every* render, so a ticking clock or
   * animation floods the layer. Off by default; the `lit-render` layer's
   * begin/end render pair already covers the common case.
   */
  litRenderVerboseEnabled: boolean;
  mouseEventEnabled: boolean;
  keyboardEventEnabled: boolean;
}

export const TIMELINE_LAYERS: readonly TimelineLayer[] = [
  {id: 'lit-lifecycle', label: 'Lit Lifecycle', color: 0x4d63ff},
  {id: 'lit-render', label: 'Lit Render', color: 0x325cff},
  {id: 'lit-render-verbose', label: 'Lit Render (verbose)', color: 0x99aeff},
  {id: 'mouse', label: 'Mouse', color: 0xa451af},
  {id: 'keyboard', label: 'Keyboard', color: 0x8151af},
];

export const DEFAULT_LAYERS_STATE: TimelineLayersState = {
  recordingState: false,
  litLifecycleEnabled: true,
  litRenderEnabled: true,
  litRenderVerboseEnabled: false,
  mouseEventEnabled: false,
  keyboardEventEnabled: false,
};

/**
 * Snapshot of the plugin's resolved feature settings, surfaced in the panel's
 * Settings tab. The plugin produces this at config time (explicit options >
 * LIT_PLUGIN_* env > defaults) and serves it from the panel server. It's the
 * baseline the panel shows; some HMR settings can then be overridden live (see
 * {@link SettingsOverride}).
 */
export interface FeatureSettings {
  hmr: {
    enabled: boolean;
    reconnect: boolean;
    onIncompatible: 'reload' | 'warn';
    childState: 'reset' | 'transfer' | 'reuse';
    indicatorEnabled: boolean;
    indicatorCount: boolean;
  };
  sourceOverlay: {
    enabled: boolean;
    /** Hotkey letter combined with Ctrl+Shift to toggle the overlay. */
    key: string;
    editor: string;
    throttleMs: number;
  };
  timeline: boolean;
  /**
   * Which layer supplied each setting, keyed like {@link SettingsOverride}
   * (plus the read-only source-overlay rows). Lets the panel label a value
   * "Zed (env)" and name the baseline a panel override replaced. Optional so
   * older producers (and snapshots) without it still type-check.
   */
  sources?: SettingSources;
}

/**
 * Where a resolved setting came from, in precedence order after a panel
 * override: an explicit `litPlugin({...})` option, a `LIT_PLUGIN_*` env var,
 * or the built-in default.
 */
export type SettingSource = 'option' | 'env' | 'default';

/** Per-setting {@link SettingSource}, as carried on {@link FeatureSettings}. */
export interface SettingSources {
  hmrReconnect?: SettingSource;
  hmrOnIncompatible?: SettingSource;
  hmrChildState?: SettingSource;
  hmrIndicatorVisible?: SettingSource;
  hmrIndicatorCount?: SettingSource;
  sourceOverlayEditor?: SettingSource;
  sourceOverlayKey?: SettingSource;
  sourceOverlayThrottleMs?: SettingSource;
}

/**
 * Runtime overrides the panel applies on top of the resolved env config, for
 * settings whose runtime is already injected (so they can change live). A
 * feature disabled at config time has no runtime, so it can't be enabled here
 * — only the behaviour of already-enabled features is overridable.
 *
 * Persisted under {@link SETTINGS_OVERRIDE_LS_KEY} (the panel and app share an
 * origin) so overrides survive reloads, and pushed live over
 * {@link SETTINGS_OVERRIDE_CHANNEL} via Vite HMR for immediate effect.
 */
export interface SettingsOverride {
  hmrReconnect?: boolean;
  hmrOnIncompatible?: 'reload' | 'warn';
  hmrChildState?: 'reset' | 'transfer' | 'reuse';
  hmrIndicatorVisible?: boolean;
  hmrIndicatorCount?: boolean;
  /** Built-in editor key for the source overlay's open-in-editor target. */
  sourceOverlayEditor?: string;
  /**
   * Flash a short outline over every Lit element that completes an update.
   * Pure preference (no config-time baseline), so `undefined` reads as off.
   */
  flashUpdates?: boolean;
  /**
   * Colour the flash by how often the element updated in the last second,
   * calm to hot, instead of one flat colour. Only meaningful with
   * {@link SettingsOverride.flashUpdates}.
   */
  flashUpdatesRamp?: boolean;
  /**
   * Mirror the timeline into Chrome DevTools' Performance panel as custom
   * tracks (via `console.timeStamp`), independent of panel recording. Pure
   * preference (no config-time baseline), so `undefined` reads as off.
   */
  chromeTracks?: boolean;
}

/**
 * Built-in editors the source overlay can open files in. Keep in sync with
 * BUILTIN_EDITORS in lib/runtime/source-overlay/editors.ts.
 */
export const SOURCE_OVERLAY_EDITORS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  {value: 'vscode', label: 'VS Code'},
  {value: 'cursor', label: 'Cursor'},
  {value: 'zed', label: 'Zed'},
  {value: 'idea', label: 'IntelliJ'},
  {value: 'windsurf', label: 'Windsurf'},
];

/** localStorage key holding the {@link SettingsOverride}. */
export const SETTINGS_OVERRIDE_LS_KEY = 'lit-devtools-overrides';

/**
 * The resolved config value each overridden key was set against, recorded so
 * the Settings tab can notice when `.env` or plugin options moved on. Kept
 * beside the {@link SettingsOverride}, never inside it: the runtime applies and
 * receives the override as-is and has no use for these.
 */
export type OverrideBaselines = Partial<
  Record<
    | 'hmrReconnect'
    | 'hmrOnIncompatible'
    | 'hmrChildState'
    | 'hmrIndicatorVisible'
    | 'hmrIndicatorCount'
    | 'sourceOverlayEditor',
    unknown
  >
>;

/** localStorage key holding the {@link OverrideBaselines}. */
export const OVERRIDE_BASELINES_LS_KEY = 'lit-devtools-override-baselines';

/** Vite HMR channel the server uses to push overrides to the app runtime. */
export const SETTINGS_OVERRIDE_CHANNEL = 'lit-devtools:settings-override';

/**
 * Vite HMR channel the DevTools "toggle source overlay" command uses to tell
 * the app runtime to toggle the overlay (the command handler runs server-side).
 */
export const SOURCE_OVERLAY_TOGGLE_CHANNEL =
  'lit-devtools:toggle-source-overlay';
