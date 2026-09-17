/**
 * @license
 * Copyright 2026 Oddsquad
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Compile-time fixture for `client.d.ts`'s `virtual:lit-plugin/timeline`
 * declaration, checked by `src/test/unit/client-types_test.ts` against the
 * sibling `tsconfig.json`, which pulls `client.d.ts` in the way a consumer's
 * `types` entry does rather than compiling it as a source file. The root
 * program can't do this job — it excludes `src/test/**`.
 *
 * Nothing here runs. It fails to compile if the ambient module goes missing
 * (the `TS2307` this fixture exists to catch) or if its copy of the timeline
 * types drifts incompatibly from `src/types/timeline.ts`.
 */

import {
  addTimelineEvent,
  addTimelineLayer,
  type TimelineEvent,
  type TimelineLayer,
} from 'virtual:lit-plugin/timeline';
import type {
  TimelineEvent as RuntimeTimelineEvent,
  TimelineLayer as RuntimeTimelineLayer,
} from '../../../types/timeline.js';

const layer: TimelineLayer = {id: 'demo', label: 'Demo', color: 0xff0000};
addTimelineLayer(layer);

const event: TimelineEvent<{ok: boolean}> = {
  layerId: 'demo',
  time: 0,
  data: {ok: true},
  title: 'demo event',
  subtitle: 'from a fixture',
  groupId: 1,
  logType: 'default',
  meta: {elementId: 1, tagName: 'my-el', source: {file: 'a.ts', line: 2}},
};
addTimelineEvent(event);

// The minimum a custom event needs.
addTimelineEvent({layerId: 'demo', time: 0, data: {ok: true}});

/**
 * Drift guard. `client.d.ts` is hand-authored and can't import from `src/`,
 * so the two copies of these interfaces are checked against each other here
 * instead. Mutual assignability, so a field added on one side only — in
 * either direction — trips this.
 */
type Identical<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

const layersAgree: Identical<TimelineLayer, RuntimeTimelineLayer> = true;
const eventsAgree: Identical<
  TimelineEvent<{ok: boolean}>,
  RuntimeTimelineEvent<{ok: boolean}>
> = true;

export {layersAgree, eventsAgree};
