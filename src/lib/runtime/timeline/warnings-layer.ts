/**
 * Lit dev-mode warnings, as the `lit-warnings` timeline layer.
 *
 * Each warning `lit-warnings.ts` captures becomes a `warning:<code>` point
 * event carrying the code and message, attributed to the element that was
 * updating when Lit issued it, else to the tag the message names. One issued
 * mid-update carries that tick's groupId, so it folds under the update.
 * Warnings issued before a recording started, or before the layer was turned
 * on, are replayed then, because the mistake is still in the page and a
 * recording that omitted it would suggest otherwise; those carry
 * `replayed: true` and go to the panel only, since the Chrome tracks already
 * got them when they happened.
 *
 * Nothing is emitted unless recording with the layer on.
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

const toEvent = (
  w: LitWarning,
  replayed: boolean,
  groupOf: (el: object) => string | undefined
): TimelineEvent => {
  const el = w.elementId === undefined ? undefined : elementById(w.elementId);
  const groupId = el === undefined || replayed ? undefined : groupOf(el);
  return {
    layerId: 'lit-warnings',
    time: now(),
    ...(groupId === undefined ? {} : {groupId}),
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

export interface WarningsLayerOptions {
  /** Where a warning goes as it is issued. */
  emit: LifecycleEmit;
  /** Where a replay goes: the panel only. */
  replayTo: LifecycleEmit;
  recording: () => boolean;
  enabled: () => boolean;
  /** The update tick an element is inside right now, if any. */
  groupOf: (el: object) => string | undefined;
}

/**
 * Wires captured warnings into `emit`; returns the replay to run when the
 * panel starts recording or turns the layer on.
 */
export const installWarningsLayer = ({
  emit,
  replayTo,
  recording,
  enabled,
  groupOf,
}: WarningsLayerOptions): {replay: () => void} => {
  setUpdatingResolver(currentlyUpdating);
  onLitWarning((w) => {
    if (recording() && enabled()) emit(toEvent(w, false, groupOf));
  });
  return {
    replay: () => {
      if (!enabled()) return;
      for (const w of litWarnings()) replayTo(toEvent(w, true, groupOf));
    },
  };
};
