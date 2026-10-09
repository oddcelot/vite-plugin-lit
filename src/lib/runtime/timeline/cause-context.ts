/**
 * What is running right now that could have scheduled an update: the answer
 * the lifecycle layer's `requestUpdate` wrapper records as a tick's cause.
 *
 * Two kinds of context, and the innermost wins: an event being dispatched
 * (an input event the browser raised, marked by the mouse and keyboard
 * layers' capture listeners, or a custom event a component dispatched, marked
 * by the custom events layer), and the element inside `performUpdate`, whose
 * render set a property on, or created, the requester.
 *
 * An event is "in flight" while its `eventPhase` is not `NONE`, which the DOM
 * flips for exactly the duration of its dispatch. That is what makes marked
 * events usable without a matching "dispatch ended" hook. `window.event` is
 * not an option: the DOM leaves it unset for listeners inside a shadow tree,
 * which is where every Lit component's handlers live.
 *
 * Only consulted while recording; nothing here may throw into the app.
 */

import type {TimelineCause} from '../../../types/timeline.js';

/** A recorded event row: the layer it is on and its `time`. */
export interface EventCause {
  layerId: string;
  time: number;
}

/** A context that may be the cause, with when it began. */
export interface SequencedCause {
  cause: TimelineCause;
  /** From {@link nextCauseSeq}; the higher sequence is the inner context. */
  seq: number;
}

interface MarkedEvent extends SequencedCause {
  event: Event;
}

let seq = 0;

/** A fresh sequence number; contexts compare these to find the innermost. */
export const nextCauseSeq = (): number => ++seq;

/**
 * Events recorded and possibly still dispatching, oldest first. Pruned of
 * finished events on every mark and lookup, so it stays a handful long.
 */
let inFlight: MarkedEvent[] = [];

const dispatching = (e: Event): boolean => e.eventPhase !== 0;

const prune = (): void => {
  if (inFlight.length > 0 && !inFlight.every((m) => dispatching(m.event))) {
    inFlight = inFlight.filter((m) => dispatching(m.event));
  }
};

/**
 * Remember that `event` was recorded as `cause`, for the handlers it is about
 * to run. Call before the dispatch (or from a capture listener that runs
 * ahead of the app's).
 */
export const markEventCause = (event: Event, cause: EventCause): void => {
  prune();
  inFlight.push({
    event,
    cause: {kind: 'event', layerId: cause.layerId, time: cause.time},
    seq: nextCauseSeq(),
  });
};

/**
 * The update tick running right now, or undefined. Registered by the
 * lifecycle layer, which owns that tracker; a registration rather than an
 * import keeps this module free of a cycle with it.
 */
let updateCause: () => SequencedCause | undefined = () => undefined;

/** Point `currentCause` at the lifecycle layer's notion of "updating now". */
export const setUpdateCauseSource = (
  source: () => SequencedCause | undefined
): void => {
  updateCause = source;
};

/** The cause an update scheduled at this moment should carry, if any. */
export const currentCause = (): TimelineCause | undefined => {
  prune();
  const event = inFlight.length > 0 ? inFlight[inFlight.length - 1] : undefined;
  const update = updateCause();
  if (event === undefined) return update?.cause;
  if (update === undefined) return event.cause;
  return event.seq > update.seq ? event.cause : update.cause;
};
