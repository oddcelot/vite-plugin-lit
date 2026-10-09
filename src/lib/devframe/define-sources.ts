/**
 * Fills in where a component is defined when the page could only say how it
 * was registered. The page names a class's `customElements.define` call by a
 * number (`defineId`) on tree nodes and timeline events, and by its stack
 * (`defineFrames`) on details. The host's resolver (the extension maps them
 * through the page's sourcemaps) turns frames into a `source`, which is set
 * on whatever carried the number or the stack before it goes on.
 *
 * A number is asked about once: the first unknown ids of a page go to it in
 * one `define-frames` command, its answer is consumed here, and the result
 * is kept per page and id, so later events and nodes are filled on the spot.
 *
 * Order is kept. Events that must wait hold the ones behind them, and
 * inspector messages do the same among themselves, so a later `gone` or
 * fresher details cannot be overtaken by an older answer. With nothing held,
 * a message passes straight through. A resolver that fails, or an answer
 * that takes longer than {@link RESOLVE_TIMEOUT_MS}, leaves things as they
 * came, and the miss is remembered rather than retried.
 */

import type {
  ElementSource,
  GeneratedFrame,
  InspectorMessage,
  InspectorTreeNode,
} from '../../types/inspector.js';
import type {TimelineEvent} from '../../types/timeline.js';
import type {TimelineSink, TimelineSource} from './source.js';

/** Maps a define call's stack to where the class is written. */
export type DefineSourceResolver = (
  frames: GeneratedFrame[]
) => Promise<ElementSource | undefined>;

export const RESOLVE_TIMEOUT_MS = 5000;

const withTimeout = <T>(
  promise: Promise<T>,
  ms: number
): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

const needsResolving = (message: InspectorMessage): boolean =>
  message.type === 'details' &&
  message.details.source === undefined &&
  message.details.defineFrames !== undefined;

/** Every `defineId` a node or its descendants carry without a `source`. */
const treeIds = (nodes: InspectorTreeNode[], into = new Set<number>()) => {
  for (const node of nodes) {
    if (node.source === undefined && node.defineId !== undefined) {
      into.add(node.defineId);
    }
    treeIds(node.children, into);
  }
  return into;
};

const fillTree = (
  nodes: InspectorTreeNode[],
  sourceOf: (id: number) => ElementSource | undefined
): InspectorTreeNode[] =>
  nodes.map((node) => {
    const source =
      node.source === undefined && node.defineId !== undefined
        ? sourceOf(node.defineId)
        : undefined;
    return {
      ...node,
      ...(source === undefined ? {} : {source}),
      children: fillTree(node.children, sourceOf),
    };
  });

/** The ids of `events` that name a define call and have no `source`. */
const eventIds = (events: TimelineEvent[]): Set<number> => {
  const ids = new Set<number>();
  for (const {meta} of events) {
    if (meta?.source === undefined && meta?.defineId !== undefined) {
      ids.add(meta.defineId);
    }
  }
  return ids;
};

/** An ask for frames that has gone out and not been answered. */
interface Batch {
  pageId: string | undefined;
  answer(frames: Record<number, GeneratedFrame[]>): void;
}

/** `source`, with its events and inspector messages passed through `resolve`. */
export const withDefineSources = (
  source: TimelineSource,
  resolve: DefineSourceResolver,
  timeoutMs = RESOLVE_TIMEOUT_MS
): TimelineSource => ({
  attach(sink: TimelineSink) {
    let inspectorQueue: Promise<void> = Promise.resolve();
    let inspectorHeld = 0;
    let eventQueue: Promise<void> = Promise.resolve();
    let eventsHeld = 0;

    // Keyed `${pageId}:${defineId}`: ids belong to one page runtime.
    const cache = new Map<string, Promise<ElementSource | undefined>>();
    // What the cached promises settled to, for filling without waiting.
    const settled = new Map<string, ElementSource | undefined>();
    const pending = new Set<Batch>();
    const keyOf = (pageId: string | undefined, id: number) =>
      `${pageId ?? ''}:${id}`;

    const isSettled = (pageId: string | undefined, id: number) =>
      settled.has(keyOf(pageId, id));
    const sourceFor = (pageId: string | undefined, id: number) =>
      settled.get(keyOf(pageId, id));

    /** Asks the page for the frames of `ids` in one command. */
    const askFrames = (
      pageId: string | undefined,
      ids: number[]
    ): Promise<Record<number, GeneratedFrame[]>> => {
      let batch!: Batch;
      const answered = new Promise<Record<number, GeneratedFrame[]>>((done) => {
        batch = {pageId, answer: done};
      });
      pending.add(batch);
      try {
        source.sendInspector({type: 'define-frames', ids});
      } catch {
        batch.answer({});
      }
      return withTimeout(answered, timeoutMs)
        .then((frames) => frames ?? {})
        .finally(() => pending.delete(batch));
    };

    /** Starts resolving every id in `ids` not already cached, in one ask. */
    const ensure = (
      pageId: string | undefined,
      ids: Iterable<number>
    ): Promise<unknown> => {
      const wanted = [...ids];
      const unknown = wanted.filter((id) => !cache.has(keyOf(pageId, id)));
      if (unknown.length > 0) {
        const asked = askFrames(pageId, unknown);
        for (const id of unknown) {
          const key = keyOf(pageId, id);
          const promise = asked
            .then((frames) => {
              const found = frames[id];
              return found === undefined
                ? undefined
                : withTimeout(resolve(found), timeoutMs);
            })
            .catch(() => undefined);
          cache.set(key, promise);
          void promise.then((value) => settled.set(key, value));
        }
      }
      return Promise.all(
        wanted.map((id) => Promise.resolve(cache.get(keyOf(pageId, id))))
      );
    };

    const fillEvents = (
      events: TimelineEvent[],
      pageId: string | undefined
    ): TimelineEvent[] =>
      events.map((event) => {
        const {meta} = event;
        if (meta?.source !== undefined || meta?.defineId === undefined) {
          return event;
        }
        const found = sourceFor(pageId, meta.defineId);
        return found === undefined
          ? event
          : {...event, meta: {...meta, source: found}};
      });

    const enrich = async (
      message: InspectorMessage,
      pageId: string | undefined
    ): Promise<InspectorMessage> => {
      if (message.type === 'tree') {
        await ensure(pageId, treeIds(message.roots));
        return {
          ...message,
          roots: fillTree(message.roots, (id) => sourceFor(pageId, id)),
        };
      }
      if (message.type !== 'details') return message;
      const {details} = message;
      const frames = details.defineFrames;
      if (details.source !== undefined || frames === undefined) return message;
      let found: ElementSource | undefined;
      try {
        found = await withTimeout(resolve(frames), timeoutMs);
      } catch {
        found = undefined;
      }
      return found === undefined
        ? message
        : {...message, details: {...details, source: found}};
    };

    /** Whether `message` is not ready as it is: it names something to look up. */
    const waitsOn = (
      message: InspectorMessage,
      pageId: string | undefined
    ): boolean => {
      if (message.type === 'tree') {
        for (const id of treeIds(message.roots)) {
          if (!isSettled(pageId, id)) return true;
        }
        return false;
      }
      return needsResolving(message);
    };

    return source.attach({
      pushEvents(events, pageId) {
        const unsettled = [...eventIds(events)].filter(
          (id) => !isSettled(pageId, id)
        );
        if (eventsHeld === 0 && unsettled.length === 0) {
          sink.pushEvents(fillEvents(events, pageId), pageId);
          return;
        }
        eventsHeld++;
        // Asked now, not when the queue reaches it, so the page is not left
        // waiting behind an earlier batch.
        const ready = ensure(pageId, unsettled);
        eventQueue = eventQueue
          .then(() => ready)
          .then(() => sink.pushEvents(fillEvents(events, pageId), pageId))
          .catch(() => {
            // The sink threw; the next batch still goes through.
          })
          .finally(() => {
            eventsHeld--;
          });
      },
      addLayer: (...args) => sink.addLayer(...args),
      hmrIncompatible: (...args) => sink.hmrIncompatible(...args),
      hmrPatched: (...args) => sink.hmrPatched(...args),
      runtimeReady(pageId, tabId) {
        // A new document starts its ids over, and the old one's are never
        // asked about again.
        if (pageId !== undefined) {
          const mine = `${pageId}:`;
          for (const key of cache.keys()) {
            if (key.startsWith(mine)) continue;
            cache.delete(key);
            settled.delete(key);
          }
        }
        sink.runtimeReady(pageId, tabId);
      },
      inspectorMessage(message, pageId) {
        if (message.type === 'define-frames') {
          // Ours: answers a command this wrapper sent, and nothing else
          // listens for it. Taken ahead of the queue, which may be waiting
          // on exactly this.
          for (const batch of pending) {
            if (batch.pageId === pageId || pageId === undefined) {
              batch.answer(message.frames);
              pending.delete(batch);
              break;
            }
          }
          return;
        }
        if (inspectorHeld === 0 && !waitsOn(message, pageId)) {
          sink.inspectorMessage(
            message.type === 'tree' && treeIds(message.roots).size > 0
              ? {
                  ...message,
                  roots: fillTree(message.roots, (id) => sourceFor(pageId, id)),
                }
              : message,
            pageId
          );
          return;
        }
        inspectorHeld++;
        // Asked now, not when the queue reaches it, as for events.
        if (message.type === 'tree')
          void ensure(pageId, treeIds(message.roots));
        inspectorQueue = inspectorQueue
          .then(() => enrich(message, pageId))
          .then((ready) => sink.inspectorMessage(ready, pageId))
          .catch(() => {
            // The sink threw; the next message still goes through.
          })
          .finally(() => {
            inspectorHeld--;
          });
      },
    });
  },
  sendInspector: (cmd) => source.sendInspector(cmd),
  toggleOverlay: () => source.toggleOverlay(),
  setRecording: (r) => source.setRecording(r),
  setLayers: (l) => source.setLayers(l),
  setSettingsOverride: (o) => source.setSettingsOverride(o),
});
