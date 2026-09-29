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
import {resetClock} from './clock.js';
import {installLifecycleLayer, setUpdateHook} from './lifecycle.js';
import {installRenderLayer, setRenderDebugEnabled} from './render.js';
import {installMouseLayer, installKeyboardLayer} from './input.js';
import {flashUpdate, setFlashEnabled, setFlashRamp} from './flash.js';
import {subscribeOverride} from '../overrides.js';
import {pageChannel} from '../page-channel.js';
import type {ViteHotLike} from '../page-channel.js';
import type {TimelineLayersState} from '../../../types/timeline.js';

// ---------------------------------------------------------------------------
// Recording state — written by the panel toggle, read by all capture layers.
// ---------------------------------------------------------------------------

const state: TimelineLayersState = {
  recordingState: false,
  litLifecycleEnabled: true,
  litRenderEnabled: true,
  litRenderVerboseEnabled: false,
  mouseEventEnabled: false,
  keyboardEventEnabled: false,
};

const recording = (): boolean => state.recordingState;
const lifecycleEnabled = (): boolean => state.litLifecycleEnabled;
const renderEnabled = (): boolean => state.litRenderEnabled;
const renderVerboseEnabled = (): boolean => state.litRenderVerboseEnabled;
const mouseEnabled = (): boolean => state.mouseEventEnabled;
const keyboardEnabled = (): boolean => state.keyboardEventEnabled;

// Drive Lit's debug event flag from recording × (render-layer-enabled OR
// verbose-layer-enabled) so lit-html only pays the per-render CustomEvent
// dispatch cost while we're actually capturing one of the two render layers.
const syncRenderDebug = (): void => {
  setRenderDebugEnabled(
    state.recordingState &&
      (state.litRenderEnabled || state.litRenderVerboseEnabled)
  );
};

// ---------------------------------------------------------------------------
// Capture layer installation
// ---------------------------------------------------------------------------

installLifecycleLayer(emit, recording, lifecycleEnabled);
installRenderLayer(emit, recording, renderEnabled, renderVerboseEnabled);
installMouseLayer(emit, recording, mouseEnabled);
installKeyboardLayer(emit, recording, keyboardEnabled);

// Flash-on-update rides the lifecycle wrappers but not the recording gate:
// it's a page-side visual the panel toggles as a preference, so it follows the
// settings override (read at boot, pushed live) rather than the layer state.
setUpdateHook(flashUpdate);

// ---------------------------------------------------------------------------
// Page channel wiring
// ---------------------------------------------------------------------------

// `import.meta.hot` exists in Vite dev builds; the tsconfig lib set doesn't
// include it, so we access it through the un-typed global shape.
const hot = (import.meta as {hot?: ViteHotLike}).hot;

subscribeOverride(hot, (o) => {
  setFlashEnabled(o.flashUpdates ?? false);
  setFlashRamp(o.flashUpdatesRamp ?? false);
});

if (hot !== undefined) {
  pageChannel.useViteHot(hot);
  setHotClient(pageChannel);

  // Panel → app: toggle recording and per-layer flags.
  pageChannel.on('lit:timeline:recording-changed', (data) => {
    const next = (data as {recording: boolean}).recording;
    // Re-zero the timeline clock on the rising edge so event times read as
    // "ms since recording started" rather than since page load.
    if (next && !state.recordingState) resetClock();
    state.recordingState = next;
    syncRenderDebug();
  });

  pageChannel.on('lit:timeline:layers-changed', (data) => {
    Object.assign(state, data as Partial<TimelineLayersState>);
    syncRenderDebug();
  });

  // Announce readiness so the panel can detect the runtime.
  pageChannel.send('lit:timeline:runtime-ready', {});
  // A carrier attached later starts with no idea a runtime exists.
  pageChannel.onAttach(() =>
    pageChannel.send('lit:timeline:runtime-ready', {})
  );
}
