/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * lit-render timeline layer — listens to the built-in lit-debug CustomEvents
 * instead of patching prototypes, so it's zero-cost when the Lit debug flag
 * is off and perfectly accurate for the render layer.
 *
 * `globalThis.emitLitDebugLogEvents = true` gates the events. We set it
 * here and unset it when the layer is disabled. The events are tagged
 * `*Unstable` in the Lit source; we tolerate missing `kind` values gracefully.
 *
 * begin render / end render share a numeric `id` → we use it as groupId so
 * the panel can show a duration bar for each render call.
 */

import type {TimelineEvent} from '../../../types/timeline.js';

type EmitFn = (event: TimelineEvent) => void;
type RecordingFn = () => boolean;
type LayerEnabledFn = () => boolean;

/** Minimal shape of the lit-debug event detail we care about. */
interface LitDebugDetail {
  kind: string;
  id?: number;
  template?: unknown;
  instance?: unknown;
}

type LitDebugEvent = CustomEvent<LitDebugDetail>;

let removeListener: (() => void) | null = null;

const onLitDebug = (
  e: Event,
  emit: EmitFn,
  recording: RecordingFn,
  layerEnabled: LayerEnabledFn
): void => {
  if (!recording() || !layerEnabled()) return;

  const detail = (e as LitDebugEvent).detail;
  if (!detail?.kind) return;

  const time = performance.now();
  const {kind, id} = detail;

  switch (kind) {
    case 'begin render':
      emit({
        layerId: 'lit-render',
        time,
        groupId: id,
        title: 'render:start',
        data: {kind, id},
      });
      break;

    case 'end render':
      emit({
        layerId: 'lit-render',
        time,
        groupId: id,
        title: 'render:end',
        data: {kind, id},
      });
      break;

    case 'template prep':
    case 'template instantiated':
    case 'template instantiated and updated':
    case 'template updating':
      emit({
        layerId: 'lit-render',
        time,
        title: kind,
        data: {kind, id},
      });
      break;

    // commit * / set part are high-volume; skip unless verbose mode added.
    default:
      break;
  }
};

/**
 * Install the lit-debug render layer.
 * Idempotent — calling again when already installed is a no-op.
 */
export const installRenderLayer = (
  emit: EmitFn,
  recording: RecordingFn,
  layerEnabled: LayerEnabledFn
): void => {
  if (removeListener !== null) return;

  // Enable the Lit debug event system (dev-only; no-op in prod builds).
  (globalThis as {emitLitDebugLogEvents?: boolean}).emitLitDebugLogEvents =
    true;

  const handler = (e: Event) => onLitDebug(e, emit, recording, layerEnabled);
  window.addEventListener('lit-debug', handler);
  removeListener = () => window.removeEventListener('lit-debug', handler);
};

/** Remove the listener and clear the Lit debug flag. */
export const uninstallRenderLayer = (): void => {
  removeListener?.();
  removeListener = null;
  (globalThis as {emitLitDebugLogEvents?: boolean}).emitLitDebugLogEvents =
    false;
};
