/**
 * The Lit devframe for hosts whose pages are not on this process's Vite dev
 * server: `lit-devtools dev`, where a page dials the host over devframe's own
 * RPC connection and carries the runtime's channel messages as two RPC
 * events, `lit:page-send` (page to server) and `lit:page-receive` (server to
 * page), and the browser extension, whose pages arrive over a port.
 *
 * Either way the definition's source is a {@link TimelineChannelCodec}, the
 * same one the Vite host uses over `server.hot`; only the
 * {@link PageTransport} under it differs. The page half of the RPC pipe is
 * `runtime/rpc-transport.ts`.
 *
 * Like `definition.ts`, nothing here imports Vite or a `node:` module.
 */

import {defineRpcFunction} from 'devframe';
import type {DevframeDefinition, DevframeNodeContext} from 'devframe';
import {channelListeners} from '../runtime/channel-listeners.js';
import type {PageTransport} from '../runtime/page-transport.js';
import {createLitDevframe} from './definition.js';
import type {CreateLitDevframeOptions} from './definition.js';
import {TimelineChannelCodec} from './page-codec.js';
import {LIT_DEVFRAME_ID, RPC_PAGE_RECEIVE, RPC_PAGE_SEND} from './protocol.js';

/**
 * The host's end of the RPC pipe `lit-devtools dev` uses: the pages' two RPC
 * events, `page-send` in and `page-receive` out to every connected page.
 * Built from the context `setup()` runs against, since that is where
 * `page-send` is registered.
 */
export const rpcPageTransport = (ctx: DevframeNodeContext): PageTransport => {
  const listeners = channelListeners();
  ctx.scope(LIT_DEVFRAME_ID).rpc.register(
    defineRpcFunction({
      name: RPC_PAGE_SEND,
      type: 'event',
      handler: (channel: string, data?: unknown) =>
        listeners.emit(channel, data),
    })
  );
  return {
    send(channel, data) {
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
    on: listeners.on,
  };
};

/**
 * The Lit devframe with a {@link TimelineChannelCodec} already connected to
 * its pages, for hosts with no Vite: `lit-devtools dev`, and the browser
 * extension's local host. Wraps `setup()` so the transport is built on the
 * same context the definition runs against, leaving `definition.ts` unaware
 * of how its source is fed. `transport` defaults to {@link rpcPageTransport};
 * the extension passes one over a `chrome.runtime.Port` (see `port-link.ts`).
 *
 * There is no dock to bring forward on a `pick`, unlike the Vite hub: the
 * standalone panel is the whole page, so the codec gets no pick hook.
 */
export function createStandaloneLitDevframe(
  options: Omit<CreateLitDevframeOptions, 'source' | 'host'> & {
    host: 'standalone' | 'extension';
  },
  transport: (ctx: DevframeNodeContext) => PageTransport = rpcPageTransport
): DevframeDefinition {
  const source = new TimelineChannelCodec();
  // What either host can do (its own picker, no HMR or source locations)
  // is `host-profile.ts`'s to say.
  const definition = createLitDevframe({...options, source});
  const {setup} = definition;

  return {
    ...definition,
    async setup(ctx: DevframeNodeContext, info) {
      // A static build or MCP run has no pages to link.
      if (ctx.mode === 'dev') source.connect(transport(ctx));
      await setup(ctx, info);
    },
  };
}
