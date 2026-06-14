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
 * Read-only snapshot of the plugin's resolved feature settings, surfaced in the
 * panel's Settings tab. The plugin produces this at config time (explicit
 * options > LIT_PLUGIN_* env > defaults) and serves it from the panel server;
 * these are config-time settings, so the panel shows them rather than mutating
 * them (change them via plugin options or env, then restart the dev server).
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
