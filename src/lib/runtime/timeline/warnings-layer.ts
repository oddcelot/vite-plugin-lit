/**
 * Lit dev-mode warnings on the lifecycle timeline layer.
 *
 * Each warning `lit-warnings.ts` captures becomes a `warning:<code>` point
 * event carrying the code and message, attributed to the element that was
 * updating when Lit issued it, else to the tag the message names. Warnings
 * issued before a recording started are replayed when it does, because the
 * mistake is still in the page and a recording that omitted it would suggest
 * otherwise; those carry `replayed: true`.
 *
 * Gated like the other lifecycle events: nothing is emitted unless recording.
 */

import {now} from './clock.js';
import {elementById, metaOf} from './identity.js';
import {currentlyUpdating, type LifecycleEmit} from './lifecycle.js';
import {
  litWarnings,
  onLitWarning,
  setUpdatingResolver,
  type LitWarning,
} from './lit-warnings.js';
import type {TimelineEvent} from '../../../types/timeline.js';

const toEvent = (w: LitWarning, replayed: boolean): TimelineEvent => {
  const el = w.elementId === undefined ? undefined : elementById(w.elementId);
  return {
    layerId: 'lit-lifecycle',
    time: now(),
    title: w.code === '' ? 'warning' : `warning:${w.code}`,
    ...(w.tagName === undefined ? {} : {subtitle: w.tagName}),
    data: {
      phase: 'warning',
      code: w.code,
      message: w.message,
      ...(replayed ? {replayed: true} : {}),
    },
    logType: 'warning',
    ...(el !== undefined
      ? {meta: metaOf(el)}
      : w.tagName === undefined
        ? {}
        : {meta: {tagName: w.tagName}}),
  };
};

/** Wires captured warnings into `emit`; returns the recording-start replay. */
export const installWarningsLayer = (
  emit: LifecycleEmit,
  recording: () => boolean,
  enabled: () => boolean
): {replay: () => void} => {
  setUpdatingResolver(currentlyUpdating);
  onLitWarning((w) => {
    if (recording() && enabled()) emit(toEvent(w, false));
  });
  return {
    replay: () => {
      if (!recording() || !enabled()) return;
      for (const w of litWarnings()) emit(toEvent(w, true));
    },
  };
};
