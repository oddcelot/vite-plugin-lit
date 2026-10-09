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
import {withDefineSources} from './define-sources.js';
import type {DefineSourceResolver} from './define-sources.js';
import {TimelineChannelCodec} from './page-codec.js';
import {withPageFetch} from './page-fetch.js';
import {createSourceMapResolver} from './source-maps.js';
import type {TimelineSource} from './source.js';
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
 * `source` with define calls resolved through the sourcemaps of the page it is
 * talking to, read by that page. A new document's scripts and maps may differ
 * (a rebuild, another site), so what was fetched is forgotten when a
 * different page becomes ready.
 */
const withPageSourceMaps = (source: TimelineSource): TimelineSource => {
  const page = withPageFetch(source);
  const resolver = createSourceMapResolver({fetch: page.fetch});
  const resolving = withDefineSources(page.source, (frames) =>
    resolver.resolve(frames)
  );
  let lastPage: string | undefined;
  return {
    ...resolving,
    attach: (sink) =>
      resolving.attach({
        pushEvents: (...args) => sink.pushEvents(...args),
        addLayer: (...args) => sink.addLayer(...args),
        hmrIncompatible: (...args) => sink.hmrIncompatible(...args),
        hmrPatched: (...args) => sink.hmrPatched(...args),
        inspectorMessage: (...args) => sink.inspectorMessage(...args),
        runtimeReady(pageId, tabId) {
          if (pageId !== undefined && pageId !== lastPage) {
            lastPage = pageId;
            resolver.reset();
          }
          sink.runtimeReady(pageId, tabId);
        },
      }),
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
    /**
     * Where a component without a stamped source is defined, from the stack
     * of its define call. The extension passes one that reads the page's
     * sourcemaps (see `define-sources.ts`); without it details pass as they
     * came.
     */
    resolveDefineSource?: DefineSourceResolver;
    /**
     * Resolve defines through the page's own sourcemaps, which the page
     * fetches for the host (see `page-fetch.ts`): `lit-devtools dev`, whose
     * pages the plugin never built. Ignored when `resolveDefineSource` is
     * given.
     */
    pageSourceMaps?: boolean;
  },
  transport: (ctx: DevframeNodeContext) => PageTransport = rpcPageTransport
): DevframeDefinition {
  const {resolveDefineSource, pageSourceMaps, ...rest} = options;
  const source = new TimelineChannelCodec();
  // What either host can do (its own picker, no HMR or source locations)
  // is `host-profile.ts`'s to say.
  const definition = createLitDevframe({
    ...rest,
    source:
      resolveDefineSource !== undefined
        ? withDefineSources(source, resolveDefineSource)
        : pageSourceMaps === true
          ? withPageSourceMaps(source)
          : source,
  });
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
