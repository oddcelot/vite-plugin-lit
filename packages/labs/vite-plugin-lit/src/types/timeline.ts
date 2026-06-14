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
