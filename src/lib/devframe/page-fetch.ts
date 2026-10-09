/**
 * A `fetch` that goes through the page. The standalone server has no business
 * reading a page's URLs itself (it would fetch whatever a connected page
 * names, from the server's network), so to map a define call's stack through
 * the page's sourcemaps it asks the page to read its own scripts: a
 * `fetch-text` command out, a `fetched-text` message back (see
 * `runtime/inspector/install.ts`, which refuses anything off the page's
 * origin).
 *
 * The reply is consumed here and never reaches the sink; nothing else
 * listens for it. Two asks for one URL at the same time share one command. A
 * page that never answers (closed, or older than the command) leaves the ask
 * waiting at most {@link FETCH_TIMEOUT_MS}, after which it reads as a failed
 * fetch. Nothing is cached: the caller (the sourcemap resolver) keeps what
 * it needs.
 */

import type {InspectorMessage} from '../../types/inspector.js';
import type {TimelineSink, TimelineSource} from './source.js';
import type {FetchedResponse} from './source-maps.js';

export const FETCH_TIMEOUT_MS = 10_000;

type Fetched = Extract<InspectorMessage, {type: 'fetched-text'}>;

export interface PageFetch {
  /** `source`, with `fetched-text` replies taken out of its messages. */
  source: TimelineSource;
  /** Reads `url` in the page. Resolves, never rejects; a miss is `ok: false`. */
  fetch: (url: string) => Promise<FetchedResponse>;
}

const responseOf = (reply: Fetched | undefined): FetchedResponse => ({
  ok: reply?.ok === true,
  headers: {
    get: (name) =>
      // The page already picked between `SourceMap` and `X-SourceMap`.
      /^(?:x-)?sourcemap$/i.test(name) ? (reply?.sourceMap ?? null) : null,
  },
  text: async () => reply?.text ?? '',
});

export const withPageFetch = (
  source: TimelineSource,
  timeoutMs = FETCH_TIMEOUT_MS
): PageFetch => {
  const waiting = new Map<string, Promise<Fetched | undefined>>();
  const answer = new Map<string, (reply: Fetched) => void>();

  const ask = (url: string): Promise<Fetched | undefined> => {
    let pending = waiting.get(url);
    if (pending !== undefined) return pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    pending = new Promise<Fetched | undefined>((resolve) => {
      answer.set(url, resolve);
      timer = setTimeout(() => resolve(undefined), timeoutMs);
      try {
        source.sendInspector({type: 'fetch-text', url});
      } catch {
        resolve(undefined);
      }
    }).finally(() => {
      clearTimeout(timer);
      waiting.delete(url);
      answer.delete(url);
    });
    waiting.set(url, pending);
    return pending;
  };

  return {
    fetch: async (url) => responseOf(await ask(url)),
    source: {
      attach: (sink: TimelineSink) =>
        source.attach({
          pushEvents: (...args) => sink.pushEvents(...args),
          addLayer: (...args) => sink.addLayer(...args),
          hmrIncompatible: (...args) => sink.hmrIncompatible(...args),
          hmrPatched: (...args) => sink.hmrPatched(...args),
          runtimeReady: (...args) => sink.runtimeReady(...args),
          inspectorMessage(message, pageId) {
            if (message.type === 'fetched-text') {
              answer.get(message.url)?.(message);
              return;
            }
            sink.inspectorMessage(message, pageId);
          },
        }),
      sendInspector: (cmd) => source.sendInspector(cmd),
      toggleOverlay: () => source.toggleOverlay(),
      setRecording: (r) => source.setRecording(r),
      setLayers: (l) => source.setLayers(l),
      setSettingsOverride: (o) => source.setSettingsOverride(o),
    },
  };
};
