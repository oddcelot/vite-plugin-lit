/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * A {@link TimelineSource} for a page that is *not* on this process's Vite
 * dev server: the page dials the devframe host over devframe's own RPC
 * connection and carries the runtime's channel messages as two RPC events,
 * `lit:page-send` (page to server) and `lit:page-receive` (server to page).
 * That lets `lit-devtools dev` show a live tree, inspector and timeline
 * instead of running on {@link createNullSource}.
 *
 * The channel names and payloads are the ones {@link HotTimelineSource} moves
 * over `import.meta.hot`; only the carrier differs. The page half is
 * `runtime/rpc-transport.ts`.
 *
 * Like `definition.ts`, nothing here imports Vite. The devframe-specific
 * wiring lives in {@link createStandaloneLitDevframe}; the class itself takes a
 * tiny {@link PageLinkNode}, so its channel-to-sink mapping is testable
 * without a running server.
 */

import {defineRpcFunction} from 'devframe';
import type {DevframeDefinition, DevframeNodeContext} from 'devframe';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
} from '../../types/inspector.js';
import type {
  InspectorCommand,
  InspectorMessage,
} from '../../types/inspector.js';
import {HMR_INCOMPATIBLE_CHANNEL} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {SETTINGS_OVERRIDE_CHANNEL} from '../../types/timeline.js';
import type {
  SettingsOverride,
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import {createLitDevframe} from './definition.js';
import type {CreateLitDevframeOptions} from './definition.js';
import {LIT_DEVFRAME_ID, RPC_PAGE_RECEIVE, RPC_PAGE_SEND} from './protocol.js';
import {layersWireFormat} from './source.js';
import type {TimelineSink, TimelineSource} from './source.js';

/** What {@link RpcTimelineSource} needs of the server it is mounted on. */
export interface PageLinkNode {
  /** Deliver messages the page sent to `handler`. Called once, on bind. */
  onPageMessage(handler: (channel: string, data: unknown) => void): void;
  /** Send a message to every connected page. */
  sendToPages(channel: string, data?: unknown): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * `TimelineSource` over devframe RPC. Messages that arrive from the network
 * are untrusted in shape, so each is checked before it reaches the sink;
 * anything unrecognised is ignored rather than thrown, which keeps a
 * misbehaving page from taking the session down.
 */
export class RpcTimelineSource implements TimelineSource {
  #node: PageLinkNode | undefined;
  #sink: TimelineSink | undefined;

  /** Wire the source to a server. Call once, before pages can connect. */
  bind(node: PageLinkNode): void {
    this.#node = node;
    node.onPageMessage((channel, data) => this.#receive(channel, data));
  }

  attach(sink: TimelineSink): () => void {
    this.#sink = sink;
    return () => {
      if (this.#sink === sink) this.#sink = undefined;
    };
  }

  #receive(channel: string, data: unknown): void {
    const sink = this.#sink;
    if (sink === undefined) return;
    switch (channel) {
      case 'lit:timeline:push-event': {
        const events = isRecord(data) ? data.events : undefined;
        sink.pushEvents(
          Array.isArray(events) ? (events as TimelineEvent[]) : []
        );
        break;
      }
      case 'lit:timeline:custom-layer': {
        const layer = isRecord(data)
          ? (data.layer as TimelineLayer)
          : undefined;
        if (layer?.id) sink.addLayer(layer);
        break;
      }
      case INSPECT_DATA_CHANNEL:
        // No dock to bring forward on a `pick`, unlike the Vite hub: the
        // standalone panel is the whole page.
        if (isRecord(data) && typeof data.type === 'string') {
          sink.inspectorMessage(data as unknown as InspectorMessage);
        }
        break;
      case HMR_INCOMPATIBLE_CHANNEL:
        if (isRecord(data))
          sink.hmrIncompatible(data as unknown as HmrIncompatibilityEvent);
        break;
      case 'lit:timeline:runtime-ready':
        sink.runtimeReady();
        break;
    }
  }

  toggleOverlay(): void {
    this.#node?.sendToPages(INSPECT_OVERLAY_TOGGLE_CHANNEL);
  }

  sendInspector(cmd: InspectorCommand): void {
    this.#node?.sendToPages(INSPECT_CMD_CHANNEL, cmd);
  }

  setRecording(recording: boolean): void {
    this.#node?.sendToPages('lit:timeline:recording-changed', {recording});
  }

  setLayers(layers: TimelineLayersState): void {
    this.#node?.sendToPages(
      'lit:timeline:layers-changed',
      layersWireFormat(layers)
    );
  }

  setSettingsOverride(override: SettingsOverride): void {
    this.#node?.sendToPages(SETTINGS_OVERRIDE_CHANNEL, override);
  }
}

export const createRpcTimelineSource = (): RpcTimelineSource =>
  new RpcTimelineSource();

/**
 * The Lit devframe with an {@link RpcTimelineSource} already mounted on it,
 * for hosts with no page of their own (`lit-devtools dev`). Wraps
 * `setup()` so the two page-link RPC functions are registered on the same
 * context the definition runs against, leaving `definition.ts` unaware of how
 * its source is fed.
 */
export function createStandaloneLitDevframe(
  options: Omit<CreateLitDevframeOptions, 'source'>
): DevframeDefinition {
  const source = new RpcTimelineSource();
  const definition = createLitDevframe({...options, source});
  const {setup} = definition;

  return {
    ...definition,
    async setup(ctx: DevframeNodeContext, info) {
      // A static build or MCP run has no pages to link.
      if (ctx.mode === 'dev') {
        source.bind({
          onPageMessage(handler) {
            ctx.scope(LIT_DEVFRAME_ID).rpc.register(
              defineRpcFunction({
                name: RPC_PAGE_SEND,
                type: 'event',
                handler: (channel: string, data?: unknown) =>
                  handler(channel, data),
              })
            );
          },
          sendToPages(channel, data) {
            ctx.rpc
              .broadcast({
                method: `${LIT_DEVFRAME_ID}:${RPC_PAGE_RECEIVE}`,
                args: [channel, data],
                // Only pages register this; the panel, on the same
                // connection list, does not.
                optional: true,
                event: true,
              })
              .catch(() => {
                // A page that vanished mid-broadcast is not an error.
              });
          },
        });
      }
      await setup(ctx, info);
    },
  };
}
