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
  layerId: string;
  /** `performance.now()` timestamp in the browser. */
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
  mouseEventEnabled: boolean;
  keyboardEventEnabled: boolean;
}

export const TIMELINE_LAYERS: readonly TimelineLayer[] = [
  {id: 'lit-lifecycle', label: 'Lit Lifecycle', color: 0x4fc08d},
  {id: 'lit-render', label: 'Lit Render', color: 0x325cff},
  {id: 'mouse', label: 'Mouse', color: 0xa451af},
  {id: 'keyboard', label: 'Keyboard', color: 0x8151af},
];

export const DEFAULT_LAYERS_STATE: TimelineLayersState = {
  recordingState: false,
  litLifecycleEnabled: true,
  litRenderEnabled: true,
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
  hmrIndicatorVisible?: boolean;
  hmrIndicatorCount?: boolean;
}

/** localStorage key holding the {@link SettingsOverride}. */
export const SETTINGS_OVERRIDE_LS_KEY = 'lit-devtools-overrides';

/** Vite HMR channel the server uses to push overrides to the app runtime. */
export const SETTINGS_OVERRIDE_CHANNEL = 'lit-devtools:settings-override';
