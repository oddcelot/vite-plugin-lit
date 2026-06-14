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

    // `template prep` fires once per *unique* template, the first time it's
    // compiled — low volume, useful as a "new template" marker.
    case 'template prep':
      emit({
        layerId: 'lit-render',
        time,
        title: kind,
        data: {kind, id},
      });
      break;

    // `template updating` / `template instantiated` / `…and updated` fire once
    // per template-bound ChildPart on *every* render — extremely high volume
    // (a ticking clock or animation floods the layer). The begin/end render
    // pair above already captures each render as a grouped duration, so these
    // add noise without signal. Skip them; re-expose behind a "verbose" toggle
    // if per-part detail is ever needed. Same rationale for commit * / set part.
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
