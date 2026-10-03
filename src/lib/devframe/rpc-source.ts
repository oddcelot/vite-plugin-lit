/**
 * A {@link TimelineSource} for a page that is *not* on this process's Vite
 * dev server: the page dials the devframe host over devframe's own RPC
 * connection and carries the runtime's channel messages as two RPC events,
 * `lit:page-send` (page to server) and `lit:page-receive` (server to page).
 * That lets `lit-devtools dev` show a live tree, inspector and timeline
 * instead of running on {@link createNullSource}.
 *
 * The channel mapping is the {@link TimelineChannelCodec} that
 * {@link HotTimelineSource} also uses over `import.meta.hot`; only the carrier
 * differs. The page half is
 * `runtime/rpc-transport.ts`.
 *
 * Like `definition.ts`, nothing here imports Vite or a `node:` module. The devframe-specific
 * wiring lives in {@link createStandaloneLitDevframe}; the class itself takes a
 * tiny {@link PageLinkNode}, so its carrier is testable
 * without a running server.
 */

import {defineRpcFunction} from 'devframe';
import type {DevframeDefinition, DevframeNodeContext} from 'devframe';
import type {InspectorCommand} from '../../types/inspector.js';
import type {
  SettingsOverride,
  TimelineLayersState,
} from '../../types/timeline.js';
import {createLitDevframe} from './definition.js';
import type {CreateLitDevframeOptions} from './definition.js';
import {TimelineChannelCodec} from './page-codec.js';
import {LIT_DEVFRAME_ID, RPC_PAGE_RECEIVE, RPC_PAGE_SEND} from './protocol.js';
import type {TimelineSink, TimelineSource} from './source.js';

/** What {@link RpcTimelineSource} needs of the server it is mounted on. */
export interface PageLinkNode {
  /** Deliver messages the page sent to `handler`. Called once, on bind. */
  onPageMessage(handler: (channel: string, data: unknown) => void): void;
  /** Send a message to every connected page. */
  sendToPages(channel: string, data?: unknown): void;
}

/**
 * `TimelineSource` over devframe RPC: a {@link TimelineChannelCodec} on a
 * carrier built from the server's {@link PageLinkNode}. There is no dock to
 * bring forward on a `pick`, unlike the Vite hub: the standalone panel is the
 * whole page, so the codec gets no pick hook.
 */
export class RpcTimelineSource implements TimelineSource {
  readonly #codec = new TimelineChannelCodec();

  /** Wire the source to a server. Call once, before pages can connect. */
  bind(node: PageLinkNode): void {
    // The node hands over every page message through one handler; fan it out
    // by channel for the codec.
    const listeners = new Map<string, (data: unknown) => void>();
    node.onPageMessage((channel, data) => listeners.get(channel)?.(data));
    this.#codec.connect({
      on: (channel, callback) => void listeners.set(channel, callback),
      send: (channel, data) => node.sendToPages(channel, data),
    });
  }

  attach(sink: TimelineSink): () => void {
    return this.#codec.attach(sink);
  }

  toggleOverlay(): void {
    this.#codec.toggleOverlay();
  }

  sendInspector(cmd: InspectorCommand): void {
    this.#codec.sendInspector(cmd);
  }

  setRecording(recording: boolean): void {
    this.#codec.setRecording(recording);
  }

  setLayers(layers: TimelineLayersState): void {
    this.#codec.setLayers(layers);
  }

  setSettingsOverride(override: SettingsOverride): void {
    this.#codec.setSettingsOverride(override);
  }
}

export const createRpcTimelineSource = (): RpcTimelineSource =>
  new RpcTimelineSource();

/**
 * The {@link PageLinkNode} `lit-devtools dev` uses: the page's two RPC
 * events, `page-send` in and `page-receive` out. Built from the context
 * `setup()` runs against, since that is where `page-send` is registered.
 */
export const rpcPageLink = (ctx: DevframeNodeContext): PageLinkNode => ({
  onPageMessage(handler) {
    ctx.scope(LIT_DEVFRAME_ID).rpc.register(
      defineRpcFunction({
        name: RPC_PAGE_SEND,
        type: 'event',
        handler: (channel: string, data?: unknown) => handler(channel, data),
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

/**
 * The Lit devframe with an {@link RpcTimelineSource} already mounted on it,
 * for hosts with no page of their own: `lit-devtools dev`, and the browser
 * extension's local host. Wraps `setup()` so the page link is bound on the
 * same context the definition runs against, leaving `definition.ts` unaware
 * of how its source is fed. `link` defaults to {@link rpcPageLink}; the
 * extension passes one over a `chrome.runtime.Port` (see `port-link.ts`).
 */
export function createStandaloneLitDevframe(
  options: Omit<CreateLitDevframeOptions, 'source' | 'host'> & {
    host: 'standalone' | 'extension';
  },
  link: (ctx: DevframeNodeContext) => PageLinkNode = rpcPageLink
): DevframeDefinition {
  const source = new RpcTimelineSource();
  // What either host can do (its own picker, no HMR or source locations)
  // is `host-profile.ts`'s to say.
  const definition = createLitDevframe({...options, source});
  const {setup} = definition;

  return {
    ...definition,
    async setup(ctx: DevframeNodeContext, info) {
      // A static build or MCP run has no pages to link.
      if (ctx.mode === 'dev') source.bind(link(ctx));
      await setup(ctx, info);
    },
  };
}
