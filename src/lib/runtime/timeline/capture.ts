/**
 * The capture gate: which timeline events are produced, and who gets them.
 *
 * Two consumers want events. The panel wants them while it is recording; the
 * Chrome Performance tracks want them while that page-side preference is on.
 * The layers run while either does, each layer only while its flag is on,
 * and each event goes only to the consumers that asked. This module owns
 * those rules and the recording edge (re-zeroing the clock), and drives Lit's
 * render debug flag so lit-html pays for its per-render events only while a
 * render layer is actually captured.
 *
 * The consumers and side effects are injected, so the rules are testable
 * without a page; `install.ts` wires the real ones.
 */

import type {
  TimelineEvent,
  TimelineLayersState,
} from '../../../types/timeline.js';

export interface CaptureSinks {
  /** The panel transport. Receives events while recording. */
  emit(event: TimelineEvent): void;
  /** The Chrome Performance tracks. Receives events while that is on. */
  chromeTracks: {push(event: TimelineEvent): void; reset(): void};
  /** Lit's debug event flag; see `render.ts`. */
  setRenderDebug(enabled: boolean): void;
  /** Re-zeroes the timeline clock. */
  resetClock(): void;
}

export interface CaptureController {
  // Function-typed properties, not methods: they are handed to the layer
  // installers unbound.
  /** Routes one event to the consumers that want it. */
  readonly out: (event: TimelineEvent) => void;
  /** Whether any consumer wants events; the layers' recording gate. */
  readonly capturing: () => boolean;
  /** Per-layer flags, as the layer installers take them. */
  readonly enabled: {
    readonly lifecycle: () => boolean;
    readonly render: () => boolean;
    readonly renderVerbose: () => boolean;
    readonly mouse: () => boolean;
    readonly keyboard: () => boolean;
  };
  /** The panel started or stopped recording. */
  setRecording(recording: boolean): void;
  /** The panel toggled layers. */
  setLayers(patch: Partial<TimelineLayersState>): void;
  /** The Chrome tracks preference changed. */
  setChromeTracks(enabled: boolean): void;
}

export const createCaptureController = (
  sinks: CaptureSinks
): CaptureController => {
  // Recording starts off; the panel turns it on.
  const state: TimelineLayersState = {
    recordingState: false,
    litLifecycleEnabled: true,
    litRenderEnabled: true,
    litRenderVerboseEnabled: false,
    mouseEventEnabled: false,
    keyboardEventEnabled: false,
  };
  let chromeTracks = false;

  const capturing = (): boolean => state.recordingState || chromeTracks;
  const syncRenderDebug = (): void => {
    sinks.setRenderDebug(
      capturing() && (state.litRenderEnabled || state.litRenderVerboseEnabled)
    );
  };

  return {
    out: (event) => {
      if (state.recordingState) sinks.emit(event);
      if (chromeTracks) sinks.chromeTracks.push(event);
    },
    capturing,
    enabled: {
      lifecycle: () => state.litLifecycleEnabled,
      render: () => state.litRenderEnabled,
      renderVerbose: () => state.litRenderVerboseEnabled,
      mouse: () => state.mouseEventEnabled,
      keyboard: () => state.keyboardEventEnabled,
    },
    setRecording(recording) {
      // Re-zero on the rising edge so event times read as "ms since recording
      // started" rather than since page load.
      if (recording && !state.recordingState) sinks.resetClock();
      state.recordingState = recording;
      syncRenderDebug();
    },
    setLayers(patch) {
      Object.assign(state, patch);
      syncRenderDebug();
    },
    setChromeTracks(enabled) {
      if (enabled === chromeTracks) return;
      chromeTracks = enabled;
      if (!enabled) sinks.chromeTracks.reset();
      syncRenderDebug();
    },
  };
};
