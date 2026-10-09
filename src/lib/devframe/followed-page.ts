/**
 * The followed page: the one page runtime whose traffic the node side
 * accepts, and everything that follows from that choice. Implements the
 * {@link TimelineSink} the source feeds, decides when a `ready` is a
 * reconnect, a reload or another page taking over, clears and forgets on
 * those edges, replays recording state and the settings override to a runtime
 * that just booted, and keeps the recording flag the runtime sees in step
 * with the shared session state.
 *
 * Talks out only through {@link FollowedPageEffects} (what the panel and the
 * terminal hear about) and {@link FollowedPageRuntime} (what the page is
 * told), so the ordering rules can be tested by driving the sink directly,
 * with no devframe booted. The {@link RecordingSession} behind it holds the
 * buffers and answers the read-side queries.
 *
 * @see CONTEXT.md for the page vocabulary.
 */

import type {InspectorMessage} from '../../types/inspector.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';
import type {
  SettingsOverride,
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import type {SessionSnapshot} from '../../types/snapshot.js';
import type {InspectorRequester} from './inspector-request.js';
import type {
  PageChangedEvent,
  RangeSummaryArgs,
  RangeSummaryResult,
  RecentEventsArgs,
  RecentEventsResult,
  UpdateSummaryArgs,
  UpdateSummaryResult,
} from './protocol.js';
import {createRecordingSession, type RecordingSession} from './session.js';
import type {TimelineSink, TimelineSource} from './source.js';

/**
 * Terminal echo for an HMR notice, for an audience that only sees dev-server
 * stdout. `code` names a diagnostic the host defines; the rest are its
 * parameters.
 */
export type HmrDiagnostic =
  | {code: 'LIT_HMR_ACCESSOR'; tagName: string}
  | {code: 'LIT_HMR_PATCH_FAILED'; tagName: string; detail: string}
  | {code: 'LIT_HMR_ATTRS_CHANGED'; tagName: string};

/** What the followed page reports outward. Every call is fire-and-forget. */
export interface FollowedPageEffects {
  /** Stamped events from the followed page, for the timeline stream. */
  events(stamped: TimelineEvent[]): void;
  /** A custom layer the followed page announced. May repeat an id. */
  layerAdded(layer: TimelineLayer): void;
  /** An inspector message from the followed page, after the caches took it. */
  inspectorMessage(message: InspectorMessage): void;
  /** Another page, or a reload of the same tab, took over. */
  pageChanged(change: PageChangedEvent): void;
  hmrPatched(event: HmrPatchEvent): void;
  hmrIncompatible(event: HmrIncompatibilityEvent): void;
  diagnose(diagnostic: HmrDiagnostic): void;
  /** The durable settings override, to replay to a runtime that booted. */
  readOverride(): Promise<SettingsOverride | undefined>;
}

/** What the followed page tells the page runtime. */
export type FollowedPageRuntime = Pick<
  TimelineSource,
  'setRecording' | 'setLayers' | 'setSettingsOverride'
>;

export interface FollowedPageOptions {
  runtime: FollowedPageRuntime;
  effects: FollowedPageEffects;
  /** Agent queries waiting on the page; resolved before the caches update. */
  requester: Pick<InspectorRequester, 'resolve'>;
  /** The shared session's layers, read whenever a runtime needs replaying. */
  layers: () => TimelineLayersState;
  /** Boot from a recorded session. See {@link RecordingSession}. */
  replay?: SessionSnapshot;
  /** Event id epoch; tests pin it. */
  epoch?: string;
  /** Wall clock for {@link PageChangedEvent.at}; tests pin it. */
  now?: () => number;
}

export interface FollowedPage extends Pick<
  RecordingSession,
  | 'history'
  | 'roots'
  | 'details'
  | 'hmrIncompatibilities'
  | 'hmrHistory'
  | 'runtime'
  | 'activePageId'
  | 'capture'
> {
  /** Hand to {@link TimelineSource.attach}. */
  readonly sink: TimelineSink;
  /**
   * The shared session's layers changed (an action, or a panel writing the
   * shared state directly). Pushes them to the runtime, and clears the buffer
   * when recording turns on.
   */
  layersChanged(layers: TimelineLayersState): void;
  /** The `recent-events` query, stamped with whether recording is on. */
  query(args: RecentEventsArgs): RecentEventsResult;
  /** The `update-summary` query, stamped with whether recording is on. */
  summarize(args: UpdateSummaryArgs): UpdateSummaryResult;
  /** The `range-summary` query, stamped with whether recording is on. */
  summarizeRange(args: RangeSummaryArgs): RangeSummaryResult;
}

const diagnosticFor = (event: HmrIncompatibilityEvent): HmrDiagnostic => {
  const {tagName, reason} = event;
  switch (reason.code) {
    case 'accessor-decorators':
      return {code: 'LIT_HMR_ACCESSOR', tagName};
    case 'patch-failed':
      return {code: 'LIT_HMR_PATCH_FAILED', tagName, detail: reason.detail};
    case 'observed-attributes-changed':
      return {code: 'LIT_HMR_ATTRS_CHANGED', tagName};
  }
};

export function createFollowedPage(options: FollowedPageOptions): FollowedPage {
  const {runtime, effects, requester, layers} = options;
  const now = options.now ?? Date.now;
  const recording = createRecordingSession({
    replay: options.replay,
    recording: layers().recordingState,
    epoch: options.epoch,
  });

  const sink: TimelineSink = {
    pushEvents(incoming, pageId) {
      if (!recording.accepts(pageId)) return;
      if (incoming.length === 0) return;
      effects.events(recording.push(incoming));
    },
    addLayer(layer, pageId) {
      if (!recording.accepts(pageId)) return;
      effects.layerAdded(layer);
    },
    inspectorMessage(message, pageId) {
      // Before the requester: an agent query must not be answered with
      // another tab's tree.
      if (!recording.accepts(pageId)) return;
      requester.resolve(message);
      recording.applyInspector(message);
      effects.inspectorMessage(message);
    },
    runtimeReady(pageId, tabId) {
      const previous = recording.activePageId();
      const previousTab = recording.activeTabId();
      const outcome = recording.pageReady(pageId, tabId);

      // A new page means a new timeline clock: the runtime re-zeroes on
      // the rising edge below, so events kept from the previous document
      // would sit in the same buffer on a different time origin and make
      // `recent-events`' `sinceMs` window meaningless. They also describe
      // a page that no longer exists. A `ready` from the page already
      // followed is only its socket reconnecting: its clock did not
      // restart, so its buffer stays.
      if (outcome !== 'same') recording.clear();
      // Element ids are minted per document, so the old page's tree and
      // details would answer for ids that mean nothing on the new one.
      // Its HMR history goes too: the new page loaded the edited code
      // fresh, so a "reload to pick up the change" no longer applies
      // and the patches never ran there.
      if (outcome === 'switched') recording.forgetPage();
      if (
        outcome === 'switched' &&
        previous !== undefined &&
        pageId !== undefined
      ) {
        effects.pageChanged({
          previousPageId: previous,
          pageId,
          reload: tabId !== undefined && tabId === previousTab,
          at: now(),
        });
      }

      // Replay current state to a runtime that just booted from its
      // defaults. Unconditional: `setRecording(false)` on a fresh page
      // is a no-op.
      const current = layers();
      runtime.setLayers(current);
      runtime.setRecording(current.recordingState);

      // The runtime reads the panel's settings override from its own
      // localStorage at boot. That only works where the panel and the
      // app share an origin (the Vite hub); in standalone mode and on
      // per-port origins (StackBlitz) the page's localStorage never
      // holds it, so a reload would fall back to the config defaults.
      // The durable store has it, so replay from there. In the hub this
      // re-sends the values the page already read. Best-effort and
      // fire-and-forget: this handler is sync, and a missing override
      // or a failed read just leaves the runtime on its defaults.
      void effects
        .readOverride()
        .then((override) => {
          if (override && Object.keys(override).length > 0) {
            runtime.setSettingsOverride(override);
          }
        })
        .catch(() => {});
    },
    hmrPatched(event, pageId) {
      // Every open tab applies the same HMR patch; only the followed
      // page's counts.
      if (!recording.accepts(pageId)) return;
      recording.pushHmrPatch(event);
      effects.hmrPatched(event);
    },
    hmrIncompatible(event, pageId) {
      if (!recording.accepts(pageId)) return;
      recording.pushHmrIncompatibility(event);
      effects.hmrIncompatible(event);
      // Informational terminal echo, never a thrown error.
      effects.diagnose(diagnosticFor(event));
    },
  };

  return {
    sink,
    // Clearing on the rising edge belongs here rather than in `set-recording`:
    // this fires for every way the shared state changes. The runtime
    // re-zeroes its timeline clock when recording turns on
    // (`runtime/timeline/clock.ts`), so events kept from the previous
    // recording sit in the buffer on a larger time origin than everything
    // captured after them. A `sinceMs` window reads them as the future, and
    // pairing a start with its end across the seam yields a negative
    // duration. Same rationale as `runtimeReady()` above, one level finer: a
    // new clock, not a new page.
    layersChanged(next) {
      recording.setRecording(next.recordingState);
      runtime.setRecording(next.recordingState);
      runtime.setLayers(next);
    },
    query: (args) => recording.query(args, layers().recordingState),
    summarize: (args) => recording.summarize(args, layers().recordingState),
    summarizeRange: (args) =>
      recording.summarizeRange(args, layers().recordingState),
    history: () => recording.history(),
    roots: () => recording.roots(),
    details: (id) => recording.details(id),
    hmrIncompatibilities: () => recording.hmrIncompatibilities(),
    hmrHistory: () => recording.hmrHistory(),
    runtime: () => recording.runtime(),
    activePageId: () => recording.activePageId(),
    capture: (meta) => recording.capture(meta),
  };
}
