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
import {captureChangedValues} from './changed-values.js';
import {erroredTasks} from '../inspector/extras.js';
import type {TimelineEvent} from '../../../types/timeline.js';

type EmitFn = (event: TimelineEvent) => void;
type RecordingFn = () => boolean;
type LayerEnabledFn = () => boolean;

/**
 * Called once per completed `performUpdate`, with the element and whether that
 * was its first update. Independent of the recording gate: the flash overlay
 * wants every update while it is on, whether or not the timeline is recording.
 */
export type UpdateHook = (el: Element, first: boolean) => void;

let updateHook: UpdateHook | null = null;

/** Install (or clear, with `null`) the per-update hook. One consumer. */
export const setUpdateHook = (hook: UpdateHook | null): void => {
  updateHook = hook;
};

/** Runs the update hook, never letting a consumer's throw reach the app. */
const notifyUpdated = (el: object, first: boolean): void => {
  if (updateHook === null) return;
  try {
    updateHook(el as Element, first);
  } catch {
    // dev tool — an overlay bug must not break the app's update cycle
  }
};

/** `ReactiveElement.hasUpdated`, read before the update flips it. */
const isFirstUpdate = (el: object): boolean =>
  (el as {hasUpdated?: boolean}).hasUpdated !== true;

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

const BRAND = Symbol.for('@oddsquad/vite-plugin-lit#timeline-lifecycle');

/** Per-instance update tick counter (bumped inside performUpdate wrapper). */
const ticks = new WeakMap<object, number>();

const tickOf = (el: object): number => ticks.get(el) ?? 0;

/**
 * Phases currently executing per element. A subclass that overrides a phase
 * and calls `super` runs two wrappers for one phase (its own prototype's and
 * the shared base's), so only the outermost emits; the inner call passes
 * through. Keeps `derive.ts`'s invariant that a phase occurs once per tick.
 */
const inFlight = new WeakMap<object, Set<string>>();

/** Name and message only: a stack would make every failed update a large event. */
const describeError = (e: unknown): {name: string; message: string} => {
  try {
    if (e instanceof Error) {
      return {name: e.name, message: e.message.slice(0, 200)};
    }
    return {name: 'Error', message: String(e).slice(0, 200)};
  } catch {
    // A hostile `toString` must not replace the app's own error.
    return {name: 'Error', message: ''};
  }
};

interface PendingAttribution {
  phase: string;
  /** Absent for point phases, which belong to no update cycle. */
  groupId?: string;
  elementId: number;
  tagName: string;
  source: ReturnType<typeof sourceOf>;
}

/**
 * Promises returned by recorded phases. Only remembered, never subscribed to:
 * a `.catch` here would mark the rejection handled and the app would lose its
 * own `unhandledrejection`. The weak key lets settled promises go.
 */
const returned = new WeakMap<Promise<unknown>, PendingAttribution>();

/** Last error reported per `@lit/task`, so one failure is one event. */
const reportedTaskErrors = new WeakMap<object, unknown>();

type AnyFn = (...args: unknown[]) => unknown;
type Proto = Record<string | symbol, AnyFn | undefined>;

/**
 * Reports `@lit/task` instances that failed since the last look. A task catches
 * its own rejection, so neither the phase's throw nor `unhandledrejection`
 * sees it; the only trace is its `error` status once the update has run.
 */
const reportTaskErrors = (
  el: object,
  groupId: string,
  elementId: number,
  tagName: string,
  source: PendingAttribution['source'],
  emit: EmitFn
): void => {
  try {
    const failing = erroredTasks(el as Element);
    for (const {task, name, error} of failing) {
      if (
        reportedTaskErrors.has(task) &&
        reportedTaskErrors.get(task) === error
      )
        continue;
      reportedTaskErrors.set(task, error);
      emit({
        layerId: 'lit-lifecycle',
        time: now(),
        groupId,
        title: 'task:error',
        subtitle: tagName,
        data: {
          phase: 'task',
          task: name,
          error: describeError(error),
          async: true,
        },
        logType: 'error',
        meta: {elementId, tagName, source},
      });
    }
  } catch {
    // dev tool — never let reporting break the app's update
  }
};

/** Phases an app commonly makes `async`; their promise is what can reject. */
const ASYNC_PHASES = ['willUpdate', 'updated', 'firstUpdated'] as const;
const CAPTURE = Symbol.for('@oddsquad/vite-plugin-lit#timeline-async-capture');

/**
 * Wrap a component's own async-capable phases so their returned promise can
 * be matched to an `unhandledrejection`. The base wrappers never see it: a
 * subclass `async updated()` replaces the base method rather than calling
 * through it. These wrappers emit nothing and only remember the promise.
 * Checked on every recorded update rather than once per class, because an
 * HMR patch copies fresh, unwrapped methods onto the prototype.
 */
const captureOwnPhases = (
  el: object,
  base: object,
  recording: RecordingFn
): void => {
  let p = Object.getPrototypeOf(el) as Proto | null;
  while (p !== null && p !== base) {
    for (const name of ASYNC_PHASES) {
      if (!Object.prototype.hasOwnProperty.call(p, name)) continue;
      const orig = p[name];
      if (typeof orig !== 'function') continue;
      if ((orig as AnyFn & {[CAPTURE]?: true})[CAPTURE] === true) continue;
      if ((orig as AnyFn & {[BRAND]?: true})[BRAND] === true) continue;
      const capture: AnyFn & {[CAPTURE]?: true} = function (
        this: object,
        ...args: unknown[]
      ) {
        const result = orig.apply(this, args);
        // Unrecorded updates do not advance the tick, so a promise from one
        // would be pinned to an older cycle.
        if (recording() && result instanceof Promise && !returned.has(result)) {
          const tagName = (this as Element).localName ?? 'unknown';
          returned.set(result, {
            phase: name,
            groupId: `${idOf(this)}:${tickOf(this)}`,
            elementId: idOf(this),
            tagName,
            source: sourceOf(this),
          });
        }
        return result;
      };
      capture[CAPTURE] = true;
      try {
        Object.defineProperty(p, name, {
          value: capture,
          writable: true,
          configurable: true,
        });
      } catch {
        // Non-configurable slot; that phase's rejections go unattributed.
      }
    }
    p = Object.getPrototypeOf(p) as Proto | null;
  }
};

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
  enabled: LayerEnabledFn,
  changedValues: LayerEnabledFn
): void => {
  if (isWrapped(proto, name)) return;
  const orig = proto[name];

  const wrapper: AnyFn & {[BRAND]?: true} = function (
    this: object,
    ...args: unknown[]
  ) {
    const isUpdate = name === 'performUpdate';
    if (!recording() || !enabled()) {
      if (!isUpdate || updateHook === null) return orig?.apply(this, args);
      const first = isFirstUpdate(this);
      const result = orig?.apply(this, args);
      notifyUpdated(this, first);
      return result;
    }
    const running = inFlight.get(this) ?? new Set<string>();
    if (running.has(name)) return orig?.apply(this, args);

    const first = isUpdate && isFirstUpdate(this);

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
    // Only `update`, and only with the layer on: `willUpdate` may be an
    // override that never reaches our wrapper, and the previews cost a
    // serialize per key.
    const changedDetail =
      name === 'update' && changedValues()
        ? captureChangedValues(this, args[0])
        : undefined;

    if (!isPoint) {
      emit({
        layerId: 'lit-lifecycle',
        time,
        groupId,
        title: name + ':start',
        subtitle: tagName,
        data:
          changedDetail === undefined
            ? {phase: name, changed}
            : {phase: name, changed, changedDetail},
        meta: {elementId, tagName, source},
      });
    }

    if (isUpdate) {
      try {
        captureOwnPhases(this, proto, recording);
      } catch {
        // dev tool — attribution is best-effort
      }
    }

    let result: unknown;
    let error: {name: string; message: string} | undefined;
    running.add(name);
    inFlight.set(this, running);
    try {
      result = orig?.apply(this, args);
    } catch (e) {
      // Describe, then rethrow the original: the app must see its own error.
      error = describeError(e);
      throw e;
    } finally {
      running.delete(name);
      if (!isPoint) {
        emit({
          layerId: 'lit-lifecycle',
          time: now(),
          groupId,
          title: name + ':end',
          subtitle: tagName,
          data: error === undefined ? {phase: name} : {phase: name, error},
          ...(error === undefined ? {} : {logType: 'error' as const}),
          meta: {elementId, tagName, source},
        });
      } else {
        emit({
          layerId: 'lit-lifecycle',
          time,
          title: name,
          subtitle: tagName,
          data: error === undefined ? {phase: name} : {phase: name, error},
          ...(error === undefined ? {} : {logType: 'error' as const}),
          meta: {elementId, tagName, source},
        });
      }
    }
    // After the bracket, not in it: a throwing update never completed, so it
    // doesn't count as one.
    if (isUpdate) notifyUpdated(this, first);
    if (result instanceof Promise && !returned.has(result)) {
      returned.set(result, {
        phase: name,
        ...(isPoint ? {} : {groupId}),
        elementId,
        tagName,
        source,
      });
    }
    if (isUpdate)
      reportTaskErrors(this, groupId, elementId, tagName, source, emit);
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
  enabled: LayerEnabledFn,
  changedValues: LayerEnabledFn = () => false
): void => {
  if (installed) return;
  installed = true;

  // Async phases fail as rejections the wrapper cannot see. Listening (rather
  // than subscribing to each returned promise) leaves the app's own handling
  // and the console's "Uncaught (in promise)" report untouched.
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      try {
        const info = returned.get(event.promise);
        if (info === undefined || !recording() || !enabled()) return;
        emit({
          layerId: 'lit-lifecycle',
          time: now(),
          ...(info.groupId === undefined ? {} : {groupId: info.groupId}),
          title: info.phase + ':rejected',
          subtitle: info.tagName,
          data: {
            phase: info.phase,
            error: describeError(event.reason),
            async: true,
          },
          logType: 'error',
          meta: {
            elementId: info.elementId,
            tagName: info.tagName,
            source: info.source,
          },
        });
      } catch {
        // dev tool — never throw from the app's rejection path
      }
    });
  }

  // Instrument from a sample already on the page (covers components defined
  // before the runtime installed — the common case, since the runtime is
  // injected after the app's modules).
  const proto = findLitElementProto();
  if (proto !== null) {
    patchBases(proto, emit, recording, enabled, changedValues);
  }

  // Also instrument on future defines — both for components registered later
  // and for the case where none were discoverable above. Kept installed for
  // the page's lifetime; `patchBases` is idempotent (wrapping is brand-guarded
  // per prototype+method), so re-running once the shared bases are wrapped is a
  // cheap no-op.
  const origDefine = customElements.define.bind(customElements);
  // Patch before defining: the platform reads connectedCallback and
  // disconnectedCallback off the prototype at define() time, so wrapping them
  // afterwards would miss the first component defined on a page with no Lit
  // element yet.
  customElements.define = (name, ctor, options) => {
    const p = ctor?.prototype as Proto | null;
    if (p != null && 'performUpdate' in p) {
      patchBases(p, emit, recording, enabled, changedValues);
    }
    origDefine(name, ctor, options);
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
  enabled: LayerEnabledFn,
  changedValues: LayerEnabledFn
): void => {
  const reProto = ownerOf(sample, 'performUpdate');
  if (reProto === null) return;
  for (const name of UPDATE_PHASES) {
    const owner = name === 'update' ? ownerOf(sample, 'update') : reProto;
    if (owner !== null) {
      wrap(owner, name, false, emit, recording, enabled, changedValues);
    }
  }
  for (const name of POINT_PHASES) {
    wrap(reProto, name, true, emit, recording, enabled, changedValues);
  }
};
