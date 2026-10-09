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
 * `shouldUpdate` is not bracketed: its return value is the news. A component's
 * own override returning `false` emits one `update skipped` point event, inside
 * the `performUpdate` bracket it vetoed.
 *
 * `requestUpdate` is wrapped too, to remember why the next tick was scheduled
 * (see `cause-context.ts`); that cause rides on the tick's `performUpdate:start`.
 *
 * A host's `@lit/task` runs are recorded as `task` spans (`task:start` when
 * `run` is called, `task:end` when it settles), and the update a run asks for
 * once it settles carries that run as its cause: it is requested from a
 * promise continuation, where nothing else is running to blame.
 *
 * Gated by the recording flag so overhead is near-zero when idle.
 */

import {idOf, metaOf, changedKeys} from './identity.js';
import {now} from './clock.js';
import {captureChangedValues} from './changed-values.js';
import {wrapDispatchEvent} from './custom-events.js';
import {
  currentCause,
  nextCauseSeq,
  setUpdateCauseSource,
} from './cause-context.js';
import {erroredTasks, tasksOf} from '../inspector/extras.js';
import type {TimelineCause, TimelineEvent} from '../../../types/timeline.js';

export type LifecycleEmit = (event: TimelineEvent) => void;
type EmitFn = LifecycleEmit;
type RecordingFn = () => boolean;
type LayerEnabledFn = () => boolean;

/**
 * Called once per completed `performUpdate` that rendered, with the element and
 * whether that was its first update. Independent of the recording gate: the flash overlay
 * wants every update while it is on, whether or not the timeline is recording.
 */
export type UpdateHook = (el: Element, first: boolean) => void;

let updateHook: UpdateHook | null = null;

/** Install (or clear, with `null`) the per-update hook. One consumer. */
export const setUpdateHook = (hook: UpdateHook | null): void => {
  updateHook = hook;
};

/**
 * Elements whose `update` ran inside the `performUpdate` now in progress. A
 * tick `shouldUpdate` vetoed never reaches `update`, and must not flash.
 */
const rendered = new WeakSet<object>();

/** Runs the update hook, never letting a consumer's throw reach the app. */
const notifyUpdated = (el: object, first: boolean): void => {
  if (updateHook === null || !rendered.has(el)) return;
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

/** The element inside `performUpdate` right now, if any. */
let updating: object | null = null;
/** When that update began, as a cause sequence (see `cause-context.ts`). */
let updatingSeq = 0;

const whileUpdating = <T>(el: object, fn: () => T): T => {
  const outer = updating;
  const outerSeq = updatingSeq;
  updating = el;
  updatingSeq = nextCauseSeq();
  try {
    return fn();
  } finally {
    updating = outer;
    updatingSeq = outerSeq;
  }
};

// The tick running right now is the cause of any update it schedules.
setUpdateCauseSource(() =>
  updating === null
    ? undefined
    : {
        cause: {
          kind: 'update',
          groupId: `${idOf(updating)}:${tickOf(updating)}`,
        },
        seq: updatingSeq,
      }
);

/**
 * Why each element's pending update was scheduled, set by the `requestUpdate`
 * that enqueued it and taken by the `performUpdate` that runs it.
 */
const pendingCause = new WeakMap<object, TimelineCause>();

/** Who is updating at this moment, for attributing a Lit warning to it. */
export const currentlyUpdating = (): {
  tagName: string;
  elementId: number;
} | null =>
  updating === null
    ? null
    : {tagName: (updating as Element).localName, elementId: idOf(updating)};

/**
 * The groupId of the update tick `el` is inside right now, or undefined when
 * it is not in `performUpdate` (an event another element dispatched during
 * this update is not part of this element's tick).
 */
export const updateGroupOf = (el: object): string | undefined =>
  updating === el ? `${idOf(el)}:${tickOf(el)}` : undefined;

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
  meta: NonNullable<TimelineEvent['meta']>;
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
  meta: PendingAttribution['meta'],
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
        subtitle: meta.tagName,
        data: {
          phase: 'task',
          task: name,
          error: describeError(error),
          async: true,
        },
        logType: 'error',
        meta,
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
          returned.set(result, {
            phase: name,
            groupId: `${idOf(this)}:${tickOf(this)}`,
            meta: metaOf(this),
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

/** Last tick whose veto was reported, per element. */
const vetoedTicks = new WeakMap<object, number>();

const OBSERVE = Symbol.for('@oddsquad/vite-plugin-lit#timeline-veto-observer');

/**
 * Wrap a component's own `shouldUpdate` so a veto reaches the timeline. The
 * base implementation always returns true, so only an override can say no, and
 * it replaces the base method rather than calling through it, which puts it
 * out of reach of the base wrappers. Lit still runs `performUpdate` around a
 * vetoed update but skips `willUpdate`/`update`/`updated`, so this event is
 * what marks that bracket as an update that did nothing. Like
 * {@link captureOwnPhases}, checked on every recorded update because an HMR
 * patch copies fresh, unwrapped methods onto the prototype.
 */
const observeVetoes = (
  el: object,
  base: object,
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  let p = Object.getPrototypeOf(el) as Proto | null;
  while (p !== null && p !== base) {
    const orig = Object.prototype.hasOwnProperty.call(p, 'shouldUpdate')
      ? p.shouldUpdate
      : undefined;
    if (
      typeof orig === 'function' &&
      (orig as AnyFn & {[OBSERVE]?: true})[OBSERVE] !== true
    ) {
      const observe: AnyFn & {[OBSERVE]?: true} = function (
        this: object,
        ...args: unknown[]
      ) {
        const result = orig.apply(this, args);
        // One event per tick: an override calling `super` runs two wrappers,
        // and both report the same `false`.
        if (
          result === false &&
          recording() &&
          enabled() &&
          vetoedTicks.get(this) !== tickOf(this)
        ) {
          vetoedTicks.set(this, tickOf(this));
          try {
            const meta = metaOf(this);
            emit({
              layerId: 'lit-lifecycle',
              time: now(),
              groupId: `${meta.elementId as number}:${tickOf(this)}`,
              title: 'update skipped',
              subtitle: meta.tagName,
              data: {phase: 'shouldUpdate', changed: changedKeys(args[0])},
              meta,
            });
          } catch {
            // dev tool — reporting must not change the app's decision
          }
        }
        return result;
      };
      observe[OBSERVE] = true;
      try {
        Object.defineProperty(p, 'shouldUpdate', {
          value: observe,
          writable: true,
          configurable: true,
        });
      } catch {
        // Non-configurable slot; that component's vetoes go unreported.
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

/** `@lit/task`'s `TaskStatus.PENDING`. */
const TASK_PENDING = 1;
const TASK_STATUS_NAMES = ['initial', 'pending', 'complete', 'error'];

/** Hosts whose tasks have been instrumented. */
const tasksInstrumented = new WeakSet<object>();
/** The host and name of each instrumented task. */
const taskInfo = new WeakMap<object, {host: object; name: string}>();
/** Each task's most recent recorded run (a `task` span's groupId). */
const latestRun = new WeakMap<object, string>();
/**
 * Recorded runs whose completion (or pending re-render) has not yet asked
 * for an update, per task: that request is the one they cause.
 */
const awaiting = new WeakMap<object, string>();
/** Tasks with an `awaiting` run, per host, so a request checks only those. */
const awaitingByHost = new WeakMap<object, Set<object>>();
/**
 * Runs whose one pending re-render has been attributed. A pending run causes
 * at most that one request; anything else the host asks for meanwhile (a
 * timer, a signal) is not the task's doing.
 */
const pendingRequested = new Set<string>();
let taskSeq = 0;

const taskStatusOf = (task: object): number | undefined => {
  try {
    const status = (task as {status?: unknown}).status;
    return typeof status === 'number' ? status : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The run of one of `host`'s tasks that is waiting to cause its next update,
 * as a cause. A run that has settled is consumed (its completion asks for one
 * update); one still pending is kept, since `autoRun: 'afterUpdate'` asks for
 * its pending re-render from a microtask and the completion comes later, but
 * it claims only that first pending request.
 * `attribute` false only forgets settled runs: their request was absorbed by an
 * update already pending, and must not blame a later one.
 */
const takeTaskCause = (
  host: object,
  attribute: boolean
): TimelineCause | undefined => {
  const tasks = awaitingByHost.get(host);
  if (tasks === undefined || tasks.size === 0) return undefined;
  let cause: TimelineCause | undefined;
  for (const task of tasks) {
    const groupId = awaiting.get(task);
    if (groupId === undefined) {
      tasks.delete(task);
      continue;
    }
    const settled =
      taskStatusOf(task) !== TASK_PENDING && latestRun.get(task) === groupId;
    if (settled) {
      awaiting.delete(task);
      tasks.delete(task);
      pendingRequested.delete(groupId);
    } else if (pendingRequested.has(groupId)) {
      continue;
    }
    if (attribute && cause === undefined) {
      cause = {kind: 'task', groupId};
      if (!settled) pendingRequested.add(groupId);
    }
  }
  return cause;
};

/**
 * Wrap `run` on the prototype owning it, once, so each run of an instrumented
 * task records a `task` span. Passes straight through while not recording or
 * for a task no recorded host has shown us.
 */
const wrapTaskRun = (
  task: object,
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  const owner = ownerOf(task as Proto, 'run');
  if (owner === null || isWrapped(owner, 'run')) return;
  const orig = owner.run;
  if (typeof orig !== 'function') return;
  const wrapper: AnyFn & {[BRAND]?: true} = function (
    this: object,
    ...args: unknown[]
  ) {
    const info = recording() && enabled() ? taskInfo.get(this) : undefined;
    if (info === undefined) return orig.apply(this, args);
    let groupId: string | undefined;
    let meta: PendingAttribution['meta'] | undefined;
    try {
      let cause: TimelineCause | undefined;
      try {
        cause = currentCause();
      } catch {
        // dev tool — attribution is best-effort
      }
      meta = metaOf(info.host);
      groupId = `task:${idOf(info.host)}:${++taskSeq}`;
      emit({
        layerId: 'lit-lifecycle',
        time: now(),
        groupId,
        title: 'task:start',
        subtitle: meta.tagName,
        data: {phase: 'task', task: info.name},
        ...(cause === undefined ? {} : {cause}),
        meta,
      });
      latestRun.set(this, groupId);
      awaiting.set(this, groupId);
      let tasks = awaitingByHost.get(info.host);
      if (tasks === undefined) {
        tasks = new Set();
        awaitingByHost.set(info.host, tasks);
      }
      tasks.add(this);
    } catch {
      // dev tool — never keep the app's task from running
    }
    const result = orig.apply(this, args);
    if (groupId === undefined || meta === undefined) return result;
    const runId = groupId;
    const runMeta = meta;
    const end = (): void => {
      try {
        const status = taskStatusOf(this);
        emit({
          layerId: 'lit-lifecycle',
          time: now(),
          groupId: runId,
          title: 'task:end',
          subtitle: runMeta.tagName,
          data: {
            phase: 'task',
            task: info.name,
            ...(status === undefined
              ? {}
              : {status: TASK_STATUS_NAMES[status] ?? String(status)}),
            ...(latestRun.get(this) === runId ? {} : {superseded: true}),
          },
          meta: runMeta,
        });
      } catch {
        // dev tool — reporting must not reach the app
      }
    };
    // `run` catches the task function's own failure and never rejects, so
    // this marks nothing handled that the app would have seen.
    if (result instanceof Promise) result.then(end, end);
    return result;
  };
  wrapper[BRAND] = true;
  try {
    Object.defineProperty(owner, 'run', {
      value: wrapper,
      writable: true,
      configurable: true,
    });
  } catch {
    // Non-configurable slot; that task's runs go unrecorded.
  }
};

/**
 * Instrument `host`'s tasks, once per host, on its first recorded update. The
 * first automatic run happens in `hostUpdate` during that same update, after
 * this, so it is recorded.
 */
const instrumentTasks = (
  host: object,
  emit: EmitFn,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  if (tasksInstrumented.has(host)) return;
  tasksInstrumented.add(host);
  for (const {task, name} of tasksOf(host as Element)) {
    taskInfo.set(task, {host, name});
    wrapTaskRun(task, emit, recording, enabled);
  }
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

  const run = function (this: object, ...args: unknown[]) {
    const isUpdate = name === 'performUpdate';
    if (name === 'update') rendered.add(this);
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

    const meta = metaOf(this);
    const elementId = meta.elementId as number;
    const tagName = meta.tagName as string;
    const tick = tickOf(this);
    const groupId = `${elementId}:${tick}`;
    const time = now();
    const changed = changedKeys(args[0]);
    const cause = isUpdate ? pendingCause.get(this) : undefined;
    if (cause !== undefined) pendingCause.delete(this);
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
        ...(cause === undefined ? {} : {cause}),
        meta,
      });
    }

    if (isUpdate) {
      try {
        captureOwnPhases(this, proto, recording);
        observeVetoes(this, proto, emit, recording, enabled);
        instrumentTasks(this, emit, recording, enabled);
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
          meta,
        });
      } else {
        emit({
          layerId: 'lit-lifecycle',
          time,
          title: name,
          subtitle: tagName,
          data: error === undefined ? {phase: name} : {phase: name, error},
          ...(error === undefined ? {} : {logType: 'error' as const}),
          meta,
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
        meta,
      });
    }
    if (isUpdate) reportTaskErrors(this, groupId, meta, emit);
    return result;
  };
  const wrapper: AnyFn & {[BRAND]?: true} = function (
    this: object,
    ...args: unknown[]
  ) {
    if (name !== 'performUpdate') return run.apply(this, args);
    rendered.delete(this);
    // Tracked whether or not anything is recording: a Lit warning is issued
    // from inside an update and wants to know whose.
    return whileUpdating(this, () => run.apply(this, args));
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
 * Wrap `proto.requestUpdate` to record what scheduled each update tick. Only
 * the request that enqueues the update counts (the first of a tick): Lit sets
 * `isUpdatePending` when it does, and a request that changes nothing leaves it
 * unset. A flag check while idle; the original always runs with its arguments.
 */
const wrapRequestUpdate = (
  proto: Proto,
  recording: RecordingFn,
  enabled: LayerEnabledFn
): void => {
  if (isWrapped(proto, 'requestUpdate')) return;
  const orig = proto.requestUpdate;
  if (typeof orig !== 'function') return;
  const wrapper: AnyFn & {[BRAND]?: true} = function (
    this: object,
    ...args: unknown[]
  ) {
    if (!recording() || !enabled()) return orig.apply(this, args);
    const pending = (this as {isUpdatePending?: boolean}).isUpdatePending;
    if (pending === true) {
      try {
        // A settled run asking now is absorbed by the pending update.
        takeTaskCause(this, false);
      } catch {
        // dev tool — never throw into the app's request
      }
      return orig.apply(this, args);
    }
    let cause: TimelineCause | undefined;
    try {
      cause = currentCause() ?? takeTaskCause(this, true);
    } catch {
      // dev tool — attribution is best-effort
    }
    const result = orig.apply(this, args);
    try {
      if (
        cause !== undefined &&
        (this as {isUpdatePending?: boolean}).isUpdatePending === true
      ) {
        pendingCause.set(this, cause);
      } else {
        // Nothing enqueued (or no cause): whatever was stored is stale.
        pendingCause.delete(this);
      }
    } catch {
      // dev tool — never throw into the app's request
    }
    return result;
  };
  wrapper[BRAND] = true;
  try {
    Object.defineProperty(proto, 'requestUpdate', {
      value: wrapper,
      writable: true,
      configurable: true,
    });
  } catch {
    // Non-configurable slot; update ticks go without a cause.
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
          subtitle: info.meta.tagName,
          data: {
            phase: info.phase,
            error: describeError(event.reason),
            async: true,
          },
          logType: 'error',
          meta: info.meta,
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
  const ruOwner = ownerOf(sample, 'requestUpdate');
  if (ruOwner !== null) wrapRequestUpdate(ruOwner, recording, enabled);
  wrapDispatchEvent(reProto);
};
