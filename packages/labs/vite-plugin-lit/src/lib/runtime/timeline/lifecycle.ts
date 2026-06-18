/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * ReactiveElement prototype instrumentation for the lifecycle timeline layer.
 *
 * Wraps the lifecycle methods listed in PHASES on the prototype of the
 * ReactiveElement class loaded by the app — not by importing lit directly,
 * to avoid multi-copy issues. The proto is resolved from the already-defined
 * custom element registry (same mechanism as the HMR patch module).
 *
 * Each wrapped method emits a paired start/end TimelineEvent so the panel
 * can render duration bars. performUpdate brackets the whole update tick and
 * bumps a per-instance tick counter that becomes the groupId shared by all
 * phase events within that tick.
 *
 * Gated by the recording flag so overhead is near-zero when idle.
 */

import {idOf, sourceOf, changedKeys} from './identity.js';
import type {TimelineEvent} from '../../../types/timeline.js';

type EmitFn = (event: TimelineEvent) => void;
type RecordingFn = () => boolean;
type LayerEnabledFn = () => boolean;

/** Phases to instrument with start/end pairs. */
const UPDATE_PHASES = [
  'performUpdate',
  'willUpdate',
  'update',
  'updated',
  'firstUpdated',
] as const;

/** Point-in-time lifecycle events (no end bracket). */
const POINT_PHASES = ['connectedCallback', 'disconnectedCallback'] as const;

const BRAND = Symbol.for('@lit-labs/vite-plugin-lit#timeline-lifecycle');

/** Per-instance update tick counter (bumped inside performUpdate wrapper). */
const ticks = new WeakMap<object, number>();

const tickOf = (el: object): number => ticks.get(el) ?? 0;

type AnyFn = (...args: unknown[]) => unknown;
type Proto = Record<string | symbol, AnyFn | undefined>;

/** Returns true if `proto[name]` is already our wrapper (idempotent install). */
const isWrapped = (proto: Proto, name: string): boolean => {
  const fn = proto[name];
  return (
    typeof fn === 'function' && (fn as AnyFn & {[BRAND]?: true})[BRAND] === true
  );
};

/**
 * Wrap `proto[name]` with a start/end pair emitting to `emit`.
 * `isPoint` methods only emit a single event (no end bracket).
 */
const wrap = (
  proto: Proto,
  name: string,
  isPoint: boolean,
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  if (isWrapped(proto, name)) return;
  const orig = proto[name];

  const wrapper: AnyFn & {[BRAND]?: true} = function (
    this: object,
    ...args: unknown[]
  ) {
    if (!recording() || !enabled()) {
      return orig?.apply(this, args);
    }

    // Bump the per-instance tick at the *start* of each performUpdate, before
    // computing the groupId, so this whole update cycle — performUpdate and the
    // willUpdate/update/updated phases it nests — shares one groupId, distinct
    // from the previous cycle's. (Reading the tick before bumping put
    // performUpdate in a different group from its own phases and let adjacent
    // cycles collide on the same tick.)
    if (name === 'performUpdate') {
      ticks.set(this, tickOf(this) + 1);
    }

    const elementId = idOf(this);
    const tagName = (this as Element).localName ?? 'unknown';
    const source = sourceOf(this);
    const tick = tickOf(this);
    const groupId = `${elementId}:${tick}`;
    const time = performance.now();
    const changed = changedKeys(args[0]);

    if (!isPoint) {
      emit({
        layerId: 'lit-lifecycle',
        time,
        groupId,
        title: name + ':start',
        subtitle: tagName,
        data: {phase: name, changed},
        meta: {elementId, tagName, source},
      });
    }

    let result: unknown;
    try {
      result = orig?.apply(this, args);
    } finally {
      if (!isPoint) {
        emit({
          layerId: 'lit-lifecycle',
          time: performance.now(),
          groupId,
          title: name + ':end',
          subtitle: tagName,
          data: {phase: name},
          meta: {elementId, tagName, source},
        });
      } else {
        emit({
          layerId: 'lit-lifecycle',
          time,
          title: name,
          subtitle: tagName,
          data: {phase: name},
          meta: {elementId, tagName, source},
        });
      }
    }
    return result;
  };
  wrapper[BRAND] = true;

  try {
    Object.defineProperty(proto, name, {
      value: wrapper,
      writable: true,
      configurable: true,
    });
  } catch {
    // Non-configurable slot; instrumentation degrades gracefully.
  }
};

/**
 * Resolve the ReactiveElement prototype from the custom element registry.
 * Looks for the first registered element that inherits from ReactiveElement
 * (identified by the presence of `reactiveElementVersions` on globalThis).
 * Returns null if no Lit element has been defined yet or if the global
 * version sentinel is missing.
 */
const resolveReactiveElementProto = (): Proto | null => {
  const versions = (globalThis as {reactiveElementVersions?: string[]})
    .reactiveElementVersions;
  if (!Array.isArray(versions) || versions.length === 0) return null;

  // Walk the custom element registry looking for a Lit element.
  const registry = customElements as unknown as {
    [Symbol.iterator]?: () => Iterator<[string, CustomElementConstructor]>;
  };
  // Standard way — iterate the registry.
  for (const [, ctor] of Object.entries(
    (
      registry as unknown as {
        _registry?: Record<string, CustomElementConstructor>;
      }
    )._registry ?? {}
  )) {
    const proto = ctor?.prototype;
    if (proto && 'performUpdate' in proto) {
      return proto as Proto;
    }
  }
  return null;
};

let installed = false;

/**
 * Install prototype instrumentation on ReactiveElement.
 * Idempotent — safe to call multiple times.
 */
export const installLifecycleLayer = (
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  if (installed) return;

  const proto = resolveReactiveElementProto();
  if (proto === null) {
    // No Lit elements defined yet; defer to first customElements.define call.
    const origDefine = customElements.define.bind(customElements);
    customElements.define = (name, ctor, options) => {
      origDefine(name, ctor, options);
      if (!installed) {
        const p = ctor?.prototype as Proto | null;
        if (p && 'performUpdate' in p) {
          patchProto(p, emit, recording, enabled);
          installed = true;
          // Restore define (we only need the first Lit element).
          customElements.define = origDefine;
        }
      }
    };
    return;
  }

  patchProto(proto, emit, recording, enabled);
  installed = true;
};

const patchProto = (
  proto: Proto,
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  for (const name of UPDATE_PHASES) {
    wrap(proto, name, false, emit, recording, enabled);
  }
  for (const name of POINT_PHASES) {
    wrap(proto, name, true, emit, recording, enabled);
  }
};
