/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Timeline runtime install entry point.
 *
 * Injected by the plugin into the host page via `transformIndexHtml` when
 * `timeline: true` is set. Sets up all capture layers and wires them to the
 * transport.
 *
 * Recording starts off; the panel iframe toggles it via the Vite HMR channel
 * (Phase 0/1) or devframe shared state (Phase 2+).
 */

import {emit, setHotClient} from './transport.js';
import {installLifecycleLayer} from './lifecycle.js';
import {installRenderLayer} from './render.js';
import {installMouseLayer, installKeyboardLayer} from './input.js';
import type {TimelineLayersState} from '../../../types/timeline.js';

// ---------------------------------------------------------------------------
// Recording state — written by the panel toggle, read by all capture layers.
// ---------------------------------------------------------------------------

const state: TimelineLayersState = {
  recordingState: false,
  litLifecycleEnabled: true,
  litRenderEnabled: true,
  mouseEventEnabled: false,
  keyboardEventEnabled: false,
};

const recording = (): boolean => state.recordingState;
const renderEnabled = (): boolean => state.litRenderEnabled;
const mouseEnabled = (): boolean => state.mouseEventEnabled;
const keyboardEnabled = (): boolean => state.keyboardEventEnabled;

// ---------------------------------------------------------------------------
// Capture layer installation
// ---------------------------------------------------------------------------

installLifecycleLayer(emit, recording);
installRenderLayer(emit, recording, renderEnabled);
installMouseLayer(emit, recording, mouseEnabled);
installKeyboardLayer(emit, recording, keyboardEnabled);

// ---------------------------------------------------------------------------
// HMR channel wiring (Phase 0/1 transport)
// ---------------------------------------------------------------------------

// `import.meta.hot` exists in Vite dev builds; the tsconfig lib set doesn't
// include it, so we access it through the un-typed global shape.
type ViteHot = {
  send: (event: string, data: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => void;
};
const hot = (import.meta as {hot?: ViteHot}).hot;

if (hot !== undefined) {
  setHotClient(hot);

  // Panel → app: toggle recording and per-layer flags.
  hot.on('lit:timeline:recording-changed', (data) => {
    state.recordingState = (data as {recording: boolean}).recording;
  });

  hot.on('lit:timeline:layers-changed', (data) => {
    Object.assign(state, data as Partial<TimelineLayersState>);
  });

  // Announce readiness so the panel can detect the runtime.
  hot.send('lit:timeline:runtime-ready', {});
}
