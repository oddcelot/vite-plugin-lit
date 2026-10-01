/**
 * Timeline runtime install entry point.
 *
 * Injected by the plugin into the host page via `transformIndexHtml` when
 * `timeline: true` is set. Sets up all capture layers and wires them to the
 * transport.
 *
 * Recording starts off; the panel iframe toggles it via the Vite HMR channel
 * (Phase 0/1) or devframe shared state (Phase 2+). Which layers capture, and
 * which consumer receives what, is `capture.ts`'s to decide.
 */

import {emit, setHotClient} from './transport.js';
import {resetClock} from './clock.js';
import {createCaptureController} from './capture.js';
import {createChromeTracksSink} from './chrome-tracks.js';
import {installLifecycleLayer, setUpdateHook} from './lifecycle.js';
import {installRenderLayer, setRenderDebugEnabled} from './render.js';
import {installMouseLayer, installKeyboardLayer} from './input.js';
import {flashUpdate, setFlashEnabled, setFlashRamp} from './flash.js';
import {subscribeOverride} from '../overrides.js';
import {preferences} from '../../settings-override.js';
import {pageChannel} from '../page-channel.js';
import {PAGE_ID} from '../page-id.js';
import type {ViteHotLike} from '../page-channel.js';
import {
  CHANNEL_LAYERS_CHANGED,
  CHANNEL_RECORDING_CHANGED,
  CHANNEL_RUNTIME_READY,
} from '../../../types/timeline.js';
import type {TimelineLayersState} from '../../../types/timeline.js';

// Recording state is written by the panel toggle, the Chrome tracks flag by
// the settings override (a page-side preference, independent of recording).
const capture = createCaptureController({
  emit,
  chromeTracks: createChromeTracksSink(),
  setRenderDebug: setRenderDebugEnabled,
  resetClock,
});

// ---------------------------------------------------------------------------
// Capture layer installation
// ---------------------------------------------------------------------------

const {out, capturing, enabled} = capture;
installLifecycleLayer(out, capturing, enabled.lifecycle);
installRenderLayer(out, capturing, enabled.render, enabled.renderVerbose);
installMouseLayer(out, capturing, enabled.mouse);
installKeyboardLayer(out, capturing, enabled.keyboard);

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
  const prefs = preferences(o);
  setFlashEnabled(prefs.flashUpdates);
  setFlashRamp(prefs.flashUpdatesRamp);
  capture.setChromeTracks(prefs.chromeTracks);
});

if (hot !== undefined) pageChannel.useViteHot(hot);

// Wired whether or not Vite is present: a page outside Vite gets its carrier
// later from `connectToDevServer()`, and these listeners move onto it then.
{
  setHotClient(pageChannel);

  // Panel → app: toggle recording and per-layer flags.
  pageChannel.on(CHANNEL_RECORDING_CHANGED, (data) => {
    capture.setRecording((data as {recording: boolean}).recording);
  });

  pageChannel.on(CHANNEL_LAYERS_CHANGED, (data) => {
    capture.setLayers(data as Partial<TimelineLayersState>);
  });

  // Announce readiness so the panel can detect the runtime.
  pageChannel.send(CHANNEL_RUNTIME_READY, {pageId: PAGE_ID});
  // A carrier attached later starts with no idea a runtime exists.
  pageChannel.onAttach(() =>
    pageChannel.send(CHANNEL_RUNTIME_READY, {pageId: PAGE_ID})
  );
}
