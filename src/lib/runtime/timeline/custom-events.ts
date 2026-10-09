/**
 * The custom events layer: events a Lit element dispatches on itself.
 *
 * `dispatchEvent` is wrapped once, on the shared ReactiveElement prototype
 * the lifecycle layer already finds, not on every instance and not on
 * `EventTarget.prototype`: only a component's own `this.dispatchEvent(...)`
 * is seen, and an event the browser dispatches never goes through it. The
 * wrapper records type, flags and a bounded detail preview, attributed to the
 * dispatching element, and is a flag check while the layer is off.
 *
 * A recorded dispatch is marked as an event cause for as long as it runs, so
 * an update a listener requests points back at this row (`cause-context.ts`).
 *
 * Runs inside the inspected page: nothing here may throw into the app, and
 * the original `dispatchEvent` always runs with the arguments it was given.
 */

import {serialize} from '../inspector/serialize.js';
import {metaOf} from './identity.js';
import {now} from './clock.js';
import {markEventCause} from './cause-context.js';
import type {TimelineEvent} from '../../../types/timeline.js';

type AnyFn = (this: object, ...args: unknown[]) => unknown;
type Proto = Record<string | symbol, AnyFn | undefined>;

const BRAND = Symbol.for('@oddsquad/vite-plugin-lit#timeline-custom-events');

/** The consumers `install.ts` wires in; unset until then, so wrapping is inert. */
interface Sink {
  emit: (event: TimelineEvent) => void;
  recording: () => boolean;
  enabled: () => boolean;
  /** The update tick `el` is inside right now, as a groupId. */
  groupOf: (el: object) => string | undefined;
}

let sink: Sink | null = null;

/**
 * Events inside their own `dispatchEvent`. Some DOM implementations (happy-dom
 * among them) re-enter `this.dispatchEvent` for the same event while walking
 * the propagation path; one dispatch is one row.
 */
const dispatching = new WeakSet<Event>();

/** Point the wrapper (installed by the lifecycle layer) at its consumers. */
export const installCustomEventsLayer = (s: Sink): void => {
  sink = s;
};

const record = (el: object, event: Event, s: Sink, time: number): void => {
  const meta = metaOf(el);
  const isCustom = event instanceof CustomEvent;
  const groupId = s.groupOf(el);
  s.emit({
    layerId: 'custom-events',
    time,
    ...(groupId === undefined ? {} : {groupId}),
    title: event.type,
    subtitle: meta.tagName,
    data: {
      type: event.type,
      kind: isCustom ? 'CustomEvent' : 'Event',
      bubbles: event.bubbles,
      composed: event.composed,
      cancelable: event.cancelable,
      ...(isCustom ? {detail: serialize(event.detail)} : {}),
    },
    meta,
  });
};

/** Wraps `dispatchEvent` for every element inheriting from `proto`. Idempotent. */
export const wrapDispatchEvent = (proto: Proto): void => {
  const orig = proto.dispatchEvent;
  if (typeof orig !== 'function') return;
  if ((orig as AnyFn & {[BRAND]?: true})[BRAND] === true) return;

  const wrapper: AnyFn & {[BRAND]?: true} = function (this, ...args) {
    const s = sink;
    const event = args[0];
    if (
      s === null ||
      !(event instanceof Event) ||
      dispatching.has(event) ||
      !s.recording() ||
      !s.enabled()
    ) {
      return orig.apply(this, args);
    }
    const time = now();
    try {
      record(this, event, s, time);
    } catch {
      // dev tool — recording must not change what the app dispatches
    }
    // Marked before the dispatch, so an update a listener requests points
    // back at this row.
    markEventCause(event, {layerId: 'custom-events', time, title: event.type});
    dispatching.add(event);
    try {
      return orig.apply(this, args);
    } finally {
      dispatching.delete(event);
    }
  };
  wrapper[BRAND] = true;
  try {
    Object.defineProperty(proto, 'dispatchEvent', {
      value: wrapper,
      writable: true,
      configurable: true,
    });
  } catch {
    // Non-configurable slot; dispatched events go unrecorded.
  }
};
