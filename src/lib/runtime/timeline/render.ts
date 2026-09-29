/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * lit-render timeline layers — listen to the built-in lit-debug CustomEvents
 * instead of patching prototypes, so they're zero-cost when the Lit debug
 * flag is off and perfectly accurate for the render layers.
 *
 * `globalThis.emitLitDebugLogEvents = true` gates the events, and lit-html
 * dispatches a CustomEvent per render whenever it's set — a real per-render
 * cost. So the caller drives the flag via {@link setRenderDebugEnabled} from
 * `recording × (lit-render OR lit-render-verbose enabled)` rather than
 * leaving it on for the whole session.
 * The events are tagged `*Unstable` in the Lit source; we tolerate missing
 * `kind` values gracefully.
 *
 * begin render / end render share a numeric `id` → we use it as groupId so
 * the panel can show a duration bar for each render call.
 *
 * `template updating` / `template instantiated[ and updated]` / `set part` /
 * `commit *` fire once per template-bound part on *every* render — extremely
 * high volume (a ticking clock or animation floods the layer). They're
 * emitted on the separate opt-in `lit-render-verbose` layer rather than
 * `lit-render`, so the common case (the begin/end render duration bar) stays
 * quiet by default.
 */

import type {TimelineEvent} from '../../../types/timeline.js';
import {idOf, sourceOf} from './identity.js';
import {now} from './clock.js';

type EmitFn = (event: TimelineEvent) => void;
type RecordingFn = () => boolean;
type LayerEnabledFn = () => boolean;

/**
 * Minimal shape of the lit-debug event detail we care about. Broader than any
 * single `kind` needs — see lit-html's `LitUnstable.DebugLog.Entry` union in
 * `packages/lit-html/src/lit-html.ts` for the exact per-kind shapes; fields
 * below are the ones this layer reads across all of them.
 */
interface LitDebugDetail {
  kind: string;
  id?: number;
  template?: unknown;
  instance?: unknown;
  /** Render options passed to lit-html's `render()`; `host` is the element. */
  options?: {host?: unknown};
  /** `template updating` / `template instantiated[ and updated]`. */
  values?: unknown[];
  /** `set part` / most `commit *` kinds. */
  value?: unknown;
  /**
   * `set part` only. Unlike every other kind, `set part` carries no
   * top-level `options` — the host lives on the `Part` instance itself
   * (`ChildPart` / `AttributePart` / `EventPart` / `ElementPart` all expose a
   * public `options: RenderOptions | undefined`), so the host is derived via
   * {@link partHost} instead of `options?.host` directly.
   */
  part?: {options?: {host?: unknown}};
  /** `set part`. */
  valueIndex?: number;
  /** `commit attribute` / `commit property` / `commit boolean attribute` /
   *  `commit event listener`. */
  name?: string;
  /** `commit event listener`. */
  addListener?: boolean;
  removeListener?: boolean;
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

/** Reads the render `host` off a `Part` for the one kind (`set part`) whose
 *  detail carries the part instead of the render `options` directly. */
const partHost = (part: LitDebugDetail['part']): unknown => part?.options?.host;

type LitDebugEvent = CustomEvent<LitDebugDetail>;

let removeListener: (() => void) | null = null;

/**
 * Reduces an arbitrary lit-html binding value to a small JSON-serializable
 * summary for the verbose layer's `data` field. Never puts the value itself
 * in `data` — it may be a DOM Node, a TemplateResult, a function, or hold a
 * reference back to the host element, none of which survive (or belong in) a
 * structured-clone over the HMR channel.
 */
const describeValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return value.length > 40
      ? `string:"${value.slice(0, 40)}…"`
      : `string:"${value}"`;
  }
  if (typeof value === 'number') return `number:${value}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  if (typeof value === 'function') {
    return `function:${value.name || 'anonymous'}`;
  }
  // lit's sentinels (`nothing`, `noChange`) are symbols.
  if (typeof value === 'symbol') return `symbol:${value.description ?? ''}`;
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object' && '_$litType$' in value) return 'template';
  if (typeof Node !== 'undefined' && value instanceof Node) {
    const tag = (value as Partial<Element>).tagName?.toLowerCase();
    return tag ? `node:<${tag}>` : `node:#${value.nodeType}`;
  }
  const ctor = (value as {constructor?: {name?: string}})?.constructor?.name;
  return `object:${ctor ?? 'Object'}`;
};

/** Summarizes each entry of a template-instance's `values` array. */
const describeValues = (values: unknown[] | undefined): string[] | undefined =>
  values?.map(describeValue);

const onLitDebug = (
  e: Event,
  emit: EmitFn,
  recording: RecordingFn,
  renderEnabled: LayerEnabledFn,
  verboseEnabled: LayerEnabledFn
): void => {
  if (!recording() || (!renderEnabled() && !verboseEnabled())) return;

  const detail = (e as LitDebugEvent).detail;
  if (!detail?.kind) return;

  const time = now();
  const {kind, id} = detail;

  switch (kind) {
    case 'begin render': {
      if (!renderEnabled()) break;
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
      if (!renderEnabled()) break;
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
      if (!renderEnabled()) break;
      emit({
        layerId: 'lit-render',
        time,
        title: kind,
        data: {kind, id},
      });
      break;

    // The events below fire once per template-bound part on *every* render —
    // extremely high volume (a ticking clock or animation floods the layer).
    // The begin/end render pair above already captures each render as a
    // grouped duration, so these live on the separate opt-in
    // `lit-render-verbose` layer instead of adding noise to `lit-render`.
    case 'template updating':
    case 'template instantiated':
    case 'template instantiated and updated': {
      if (!verboseEnabled()) break;
      const meta = hostMeta(detail.options?.host);
      emit({
        layerId: 'lit-render-verbose',
        time,
        title: kind,
        subtitle: meta?.tagName,
        data: {kind, values: describeValues(detail.values)},
        meta,
      });
      break;
    }

    case 'set part': {
      if (!verboseEnabled()) break;
      const meta = hostMeta(partHost(detail.part));
      emit({
        layerId: 'lit-render-verbose',
        time,
        title: kind,
        subtitle: meta?.tagName,
        data: {
          kind,
          valueIndex: detail.valueIndex,
          value: describeValue(detail.value),
        },
        meta,
      });
      break;
    }

    case 'commit nothing to child': {
      if (!verboseEnabled()) break;
      const meta = hostMeta(detail.options?.host);
      emit({
        layerId: 'lit-render-verbose',
        time,
        title: kind,
        subtitle: meta?.tagName,
        data: {kind},
        meta,
      });
      break;
    }

    case 'commit text':
    case 'commit node':
    case 'commit to element binding': {
      if (!verboseEnabled()) break;
      const meta = hostMeta(detail.options?.host);
      emit({
        layerId: 'lit-render-verbose',
        time,
        title: kind,
        subtitle: meta?.tagName,
        data: {kind, value: describeValue(detail.value)},
        meta,
      });
      break;
    }

    case 'commit attribute':
    case 'commit property':
    case 'commit boolean attribute': {
      if (!verboseEnabled()) break;
      const meta = hostMeta(detail.options?.host);
      emit({
        layerId: 'lit-render-verbose',
        time,
        title: kind,
        subtitle: meta?.tagName,
        data: {kind, name: detail.name, value: describeValue(detail.value)},
        meta,
      });
      break;
    }

    case 'commit event listener': {
      if (!verboseEnabled()) break;
      const meta = hostMeta(detail.options?.host);
      emit({
        layerId: 'lit-render-verbose',
        time,
        title: kind,
        subtitle: meta?.tagName,
        data: {
          kind,
          name: detail.name,
          addListener: detail.addListener,
          removeListener: detail.removeListener,
        },
        meta,
      });
      break;
    }

    // Unknown or future `*Unstable` kind — ignore rather than guess a shape.
    default:
      break;
  }
};

/**
 * Install the lit-debug render layers (`lit-render` and the opt-in
 * `lit-render-verbose`).
 * Idempotent — calling again when already installed is a no-op.
 */
export const installRenderLayer = (
  emit: EmitFn,
  recording: RecordingFn,
  renderEnabled: LayerEnabledFn,
  verboseEnabled: LayerEnabledFn
): void => {
  if (removeListener !== null) return;

  // The listener is cheap and always attached; the per-render cost lives in the
  // `emitLitDebugLogEvents` flag, which the caller toggles via
  // `setRenderDebugEnabled` only while actively capturing.
  const handler = (e: Event) =>
    onLitDebug(e, emit, recording, renderEnabled, verboseEnabled);
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
