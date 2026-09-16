/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Public timeline API — re-exported by the `virtual:lit-plugin/timeline`
 * virtual module so app code and other plugins can contribute events and
 * custom layers without reaching into plugin internals.
 *
 * This module shares the same `transport.ts` instance as `install.ts`, so
 * events emitted here flow through the same batched HMR channel to the panel.
 */

import {emit, setHotClientCallback} from './transport.js';
import type {TimelineEvent, TimelineLayer} from '../../../types/timeline.js';

export type {TimelineEvent, TimelineLayer};

/**
 * Emit a custom timeline event from app code.
 *
 * The event is forwarded to the Timeline panel when recording is active.
 * Use a custom `layerId` registered with `addTimelineLayer`, or one of the
 * built-in layer ids (`'lit-lifecycle'`, `'lit-render'`, `'mouse'`,
 * `'keyboard'`).
 *
 * No-ops in production (the HMR channel is absent; events are dropped in the
 * transport queue).
 */
export const addTimelineEvent = (event: TimelineEvent): void => {
  emit(event);
};

type ViteHot = {send: (event: string, data: unknown) => void};

/**
 * Register a custom timeline layer and announce it to the panel.
 *
 * The panel adds the layer to its toggle strip after the built-in layers.
 * The registration message is sent once on first call; duplicate ids are
 * ignored.
 */
export const addTimelineLayer = (layer: TimelineLayer): void => {
  const send = (): void => {
    (import.meta as {hot?: ViteHot}).hot?.send('lit:timeline:custom-layer', {
      layer,
    });
  };
  setHotClientCallback(send);
};
