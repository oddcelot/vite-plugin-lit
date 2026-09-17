/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * A recorded DevTools session, frozen so someone else can open it.
 *
 * The point is not "a static copy of the panel". It is a bug report a
 * maintainer can actually act on: the timeline of what happened, the component
 * tree as it stood, the details of the components that were inspected, and any
 * HMR incompatibilities that fired — opened in a browser with no checkout of
 * the reporter's app and no reproduction steps.
 *
 * Everything here is already in the node side's hands during a live session
 * (see `lib/devframe/definition.ts`, which caches exactly these four things),
 * which is why capture needs no new transport: the dev server exports its own
 * state.
 */

import type {HmrIncompatibilityEvent} from './hmr-incompatibility.js';
import type {InspectorDetails, InspectorTreeNode} from './inspector.js';
import type {TimelineEvent, TimelineLayer} from './timeline.js';

/** Everything a frozen panel needs to render a past session. */
export interface SessionSnapshot {
  /** ISO timestamp of the export, shown by the frozen panel. */
  capturedAt: string;
  /** Plugin version the session was recorded on. */
  version: string;
  /** Custom layers registered by the app, so recorded events keep their labels. */
  customLayers: TimelineLayer[];
  /** The component tree as it stood at export time. */
  roots: InspectorTreeNode[];
  /**
   * Details for every component whose details were fetched during the
   * session. Only these ids can be baked — details are collected from live
   * DOM, so a component nobody opened has none to freeze.
   */
  details: InspectorDetails[];
  /** The recorded timeline, up to the node side's ring-buffer cap. */
  events: TimelineEvent[];
  /** HMR incompatibilities reported during the session. */
  hmrIncompatibilities: HmrIncompatibilityEvent[];
}
