/**
 * Fills in where a component is defined when the page could only say how it
 * was registered: details that arrive with `defineFrames` and no `source` are
 * held until the host's resolver (the extension maps them through the page's
 * sourcemaps) has had its say, then passed on with `source` set.
 *
 * Inspector messages keep their order: once one is held, those behind it
 * wait for it, so a later `gone` or fresher details cannot be overtaken by an
 * older answer. With nothing held, a message passes straight through. A
 * resolver that fails or takes longer than {@link RESOLVE_TIMEOUT_MS} leaves
 * the details as they came.
 */

import type {
  ElementSource,
  GeneratedFrame,
  InspectorMessage,
} from '../../types/inspector.js';
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

const enrich = async (
  message: InspectorMessage,
  resolve: DefineSourceResolver,
  timeoutMs: number
): Promise<InspectorMessage> => {
  if (message.type !== 'details') return message;
  const {details} = message;
  const frames = details.defineFrames;
  if (details.source !== undefined || frames === undefined) return message;
  let source: ElementSource | undefined;
  try {
    source = await withTimeout(resolve(frames), timeoutMs);
  } catch {
    source = undefined;
  }
  return source === undefined
    ? message
    : {...message, details: {...details, source}};
};

const needsResolving = (message: InspectorMessage): boolean =>
  message.type === 'details' &&
  message.details.source === undefined &&
  message.details.defineFrames !== undefined;

/** `source`, with its inspector messages passed through `resolve`. */
export const withDefineSources = (
  source: TimelineSource,
  resolve: DefineSourceResolver,
  timeoutMs = RESOLVE_TIMEOUT_MS
): TimelineSource => ({
  attach(sink: TimelineSink) {
    let queue: Promise<void> = Promise.resolve();
    let held = 0;
    return source.attach({
      pushEvents: (...args) => sink.pushEvents(...args),
      addLayer: (...args) => sink.addLayer(...args),
      hmrIncompatible: (...args) => sink.hmrIncompatible(...args),
      hmrPatched: (...args) => sink.hmrPatched(...args),
      runtimeReady: (...args) => sink.runtimeReady(...args),
      inspectorMessage(message, pageId) {
        if (held === 0 && !needsResolving(message)) {
          sink.inspectorMessage(message, pageId);
          return;
        }
        held++;
        queue = queue
          .then(() => enrich(message, resolve, timeoutMs))
          .then((ready) => sink.inspectorMessage(ready, pageId))
          .catch(() => {
            // The sink threw; the next message still goes through.
          })
          .finally(() => {
            held--;
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
