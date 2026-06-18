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
 * `globalThis.emitLitDebugLogEvents = true` gates the events, and lit-html
 * dispatches a CustomEvent per render whenever it's set — a real per-render
 * cost. So the caller drives the flag via {@link setRenderDebugEnabled} from
 * `recording × layer-enabled` rather than leaving it on for the whole session.
 * The events are tagged `*Unstable` in the Lit source; we tolerate missing
 * `kind` values gracefully.
 *
 * begin render / end render share a numeric `id` → we use it as groupId so
 * the panel can show a duration bar for each render call.
 */

import type {TimelineEvent} from '../../../types/timeline.js';
import {idOf, sourceOf} from './identity.js';
import {now} from './clock.js';

type EmitFn = (event: TimelineEvent) => void;
type RecordingFn = () => boolean;
type LayerEnabledFn = () => boolean;

/** Minimal shape of the lit-debug event detail we care about. */
interface LitDebugDetail {
  kind: string;
  id?: number;
  template?: unknown;
  instance?: unknown;
  /** Render options passed to lit-html's `render()`; `host` is the element. */
  options?: {host?: unknown};
}

/**
 * Builds the element-identity `meta` for a render event from the render
 * `host` (the LitElement whose `render()` produced these debug events).
 * Uses the same id/source maps as the lifecycle layer so an element keeps one
 * stable id across both layers. Returns undefined for host-less renders
 * (e.g. a bare lit-html `render()` call not driven by a LitElement).
 */
const hostMeta = (
  host: unknown
): NonNullable<TimelineEvent['meta']> | undefined => {
  if (host === null || typeof host !== 'object') return undefined;
  return {
    elementId: idOf(host),
    tagName: (host as Element).localName ?? 'unknown',
    source: sourceOf(host),
  };
};

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

  const time = now();
  const {kind, id} = detail;

  switch (kind) {
    case 'begin render': {
      const meta = hostMeta(detail.options?.host);
      emit({
        layerId: 'lit-render',
        time,
        groupId: id,
        title: 'render:start',
        subtitle: meta?.tagName,
        data: {kind, id},
        meta,
      });
      break;
    }

    case 'end render': {
      const meta = hostMeta(detail.options?.host);
      emit({
        layerId: 'lit-render',
        time,
        groupId: id,
        title: 'render:end',
        subtitle: meta?.tagName,
        data: {kind, id},
        meta,
      });
      break;
    }

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

  // The listener is cheap and always attached; the per-render cost lives in the
  // `emitLitDebugLogEvents` flag, which the caller toggles via
  // `setRenderDebugEnabled` only while actively capturing.
  const handler = (e: Event) => onLitDebug(e, emit, recording, layerEnabled);
  window.addEventListener('lit-debug', handler);
  removeListener = () => window.removeEventListener('lit-debug', handler);
};

/**
 * Toggle Lit's debug event system. Enabling makes lit-html dispatch a
 * CustomEvent on every render (dev-only; no-op in prod builds), so the caller
 * keeps it off unless the render layer is actively recording.
 */
export const setRenderDebugEnabled = (enabled: boolean): void => {
  (globalThis as {emitLitDebugLogEvents?: boolean}).emitLitDebugLogEvents =
    enabled;
};

/** Remove the listener and clear the Lit debug flag. */
export const uninstallRenderLayer = (): void => {
  removeListener?.();
  removeListener = null;
  setRenderDebugEnabled(false);
};
