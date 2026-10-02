/**
 * Public timeline API — re-exported by the `virtual:lit-plugin/timeline`
 * virtual module so app code and other plugins can contribute events and
 * custom layers without reaching into plugin internals.
 *
 * This module shares the same `transport.ts` instance as `install.ts`, so
 * events emitted here flow through the same batched HMR channel to the panel.
 */

import {pageChannel} from '../page-channel.js';
import {PAGE_ID} from '../page-id.js';
import {emit, setHotClientCallback} from './transport.js';
import {CHANNEL_CUSTOM_LAYER} from '../../../types/timeline.js';
import type {TimelineEvent, TimelineLayer} from '../../../types/timeline.js';

export type {TimelineEvent, TimelineLayer};

/**
 * Emit a custom timeline event from app code.
 *
 * The event is forwarded to the Timeline panel when recording is active.
 * Use a custom `layerId` registered with `addTimelineLayer`, or one of the
 * built-in layer ids (`'lit-lifecycle'`, `'lit-render'`,
 * `'lit-render-verbose'`, `'mouse'`, `'keyboard'`).
 *
 * No-ops in production (the HMR channel is absent; events are dropped in the
 * transport queue).
 */
export const addTimelineEvent = (event: TimelineEvent): void => {
  emit(event);
};

const announcedLayers: TimelineLayer[] = [];

// A carrier attached later (the dev server's own RPC link, say) never saw the
// layers registered before it, so they are announced to it again.
pageChannel.onAttach(() => {
  for (const layer of announcedLayers) {
    pageChannel.send(CHANNEL_CUSTOM_LAYER, {layer, pageId: PAGE_ID});
  }
});

/**
 * Register a custom timeline layer and announce it to the panel.
 *
 * The panel adds the layer to its toggle strip after the built-in layers.
 * The registration message is sent once on first call; duplicate ids are
 * ignored.
 */
export const addTimelineLayer = (layer: TimelineLayer): void => {
  const send = (): void => {
    announcedLayers.push(layer);
    pageChannel.send(CHANNEL_CUSTOM_LAYER, {layer, pageId: PAGE_ID});
  };
  setHotClientCallback(send);
};
