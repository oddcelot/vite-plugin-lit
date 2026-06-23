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
import {now} from './clock.js';
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
    const time = now();
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
          time: now(),
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
 * Finds the prototype in `proto`'s chain that *owns* `name` as an own property,
 * or null if none does.
 */
const ownerOf = (proto: Proto, name: string): Proto | null => {
  let p: Proto | null = proto;
  while (p !== null && !Object.prototype.hasOwnProperty.call(p, name)) {
    p = Object.getPrototypeOf(p) as Proto | null;
  }
  return p;
};

/**
 * Returns any defined Lit element's prototype (duck-typed by `performUpdate`),
 * or null if none can be found yet. One sample is enough: its chain leads to
 * the shared ReactiveElement/LitElement base prototypes every component
 * inherits.
 *
 * Tries the non-standard `_registry` map first, then falls back to sampling a
 * live upgraded element from the DOM — `_registry` isn't present in every
 * engine (e.g. some Chrome builds), and without this fallback an app whose
 * components were all defined before the runtime installed gets no lifecycle
 * instrumentation at all.
 */
const findLitElementProto = (): Proto | null => {
  const registry = (
    customElements as unknown as {
      _registry?: Record<string, CustomElementConstructor>;
    }
  )._registry;
  if (registry !== undefined) {
    for (const ctor of Object.values(registry)) {
      const proto = ctor?.prototype;
      if (proto != null && 'performUpdate' in proto) return proto as Proto;
    }
  }
  if (typeof document !== 'undefined') {
    for (const el of document.querySelectorAll('*')) {
      const proto = Object.getPrototypeOf(el) as Proto | null;
      if (proto != null && 'performUpdate' in proto) return proto;
    }
  }
  return null;
};

let installed = false;

/**
 * Install lifecycle instrumentation for *every* Lit element on the page.
 *
 * The phases live on the shared ReactiveElement/LitElement base prototypes, so
 * wrapping them there instruments all components at once — not just the first
 * one registered (the old behavior, which also silently no-op'd when Vite
 * served the production Lit build, since that omits the `reactiveElementVersions`
 * sentinel the resolver gated on).
 *
 * A component that overrides `willUpdate`/`updated`/`firstUpdated` *without*
 * calling `super` shadows the base no-op and won't report that phase — an
 * accepted limitation; the common case and `super`-calling overrides report.
 *
 * Idempotent — wrapping is brand-guarded per prototype+method.
 */
export const installLifecycleLayer = (
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  if (installed) return;
  installed = true;

  // Instrument from a sample already on the page (covers components defined
  // before the runtime installed — the common case, since the runtime is
  // injected after the app's modules).
  const proto = findLitElementProto();
  if (proto !== null) {
    patchBases(proto, emit, recording, enabled);
  }

  // Also instrument on future defines — both for components registered later
  // and for the case where none were discoverable above. Kept installed for
  // the page's lifetime; `patchBases` is idempotent (wrapping is brand-guarded
  // per prototype+method), so re-running once the shared bases are wrapped is a
  // cheap no-op.
  const origDefine = customElements.define.bind(customElements);
  customElements.define = (name, ctor, options) => {
    origDefine(name, ctor, options);
    const p = ctor?.prototype as Proto | null;
    if (p != null && 'performUpdate' in p) {
      patchBases(p, emit, recording, enabled);
    }
  };
};

/**
 * Wraps the lifecycle phases on the shared base prototypes reachable from
 * `sample`. `performUpdate` is never overridden by app code, so walking up from
 * any Lit element lands on `ReactiveElement.prototype` — which owns the update/
 * connect lifecycle, shared by all components. `update` is wrapped on its
 * effective owner instead (`LitElement.prototype` overrides it to drive
 * `render()`), so the timed call is the one that actually runs.
 */
const patchBases = (
  sample: Proto,
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  const reProto = ownerOf(sample, 'performUpdate');
  if (reProto === null) return;
  for (const name of UPDATE_PHASES) {
    const owner = name === 'update' ? ownerOf(sample, 'update') : reProto;
    if (owner !== null) wrap(owner, name, false, emit, recording, enabled);
  }
  for (const name of POINT_PHASES) {
    wrap(reProto, name, true, emit, recording, enabled);
  }
};
