/**
 * The recording session behind the {@link TimelineSink}: ring buffers, event
 * id stamping, the rising-edge clear, the `sinceMs`/`limit` window and the
 * inspector caches. Plain state and pure queries -- no devframe, no Vite, no
 * streams -- so the window semantics can be unit-tested without booting
 * anything. Private to `followed-page.ts`, which decides when to clear, forget
 * and accept; nothing else drives it.
 *
 * @see plans/devframe-foundation.md
 */

import type {
  InspectorDetails,
  InspectorMessage,
  InspectorTreeNode,
} from '../../types/inspector.js';
import {MAX_HMR_INCOMPATIBILITIES} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {MAX_HMR_PATCHES} from '../../types/hmr-patch.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';
import type {TimelineEvent, TimelineLayer} from '../../types/timeline.js';
import type {SessionSnapshot} from '../../types/snapshot.js';
import {rollup, toSpans} from '../timeline/derive.js';
import {normalizeRange, summarizeRange} from '../timeline/range.js';
import {updateCycles} from '../timeline/model.js';
import {RECENT_EVENTS_BUFFER_SIZE} from './protocol.js';
import type {
  HmrHistoryEntry,
  LitRuntimeInfo,
  RangeSummaryArgs,
  RangeSummaryResult,
  RecentEventsArgs,
  RecentEventsResult,
  UpdateSummaryArgs,
  UpdateSummaryResult,
} from './protocol.js';

export interface RecordingSessionOptions {
  /** Boot from a recorded session: caches start populated, ids are kept. */
  replay?: SessionSnapshot;
  /** Whether recording is already on, so a first `setRecording(true)` is not an edge. */
  recording?: boolean;
  /** Id epoch (the session start). Defaults to `Date.now()` in base 36. */
  epoch?: string;
}

export interface RecordingSession {
  /**
   * Stamp `${epoch}-${seq}` on events that lack an id (a replayed or
   * already-identified event keeps its own), buffer them and return the
   * stamped copies for the caller to stream.
   */
  push(events: readonly TimelineEvent[]): TimelineEvent[];
  /** Forget the buffered events (a new page, or a new recording clock). */
  clear(): void;
  /**
   * Report the recording flag. Turning it on (a rising edge) clears the
   * buffer, because the runtime re-zeroes its clock on that edge.
   */
  setRecording(recording: boolean): void;
  /** A copy of the buffered events, oldest first. */
  history(): TimelineEvent[];
  /** The `recent-events` query. */
  query(args: RecentEventsArgs, recording: boolean): RecentEventsResult;
  /** The `update-summary` query. */
  summarize(args: UpdateSummaryArgs, recording: boolean): UpdateSummaryResult;
  /** The `range-summary` query. Throws on a window with no width. */
  summarizeRange(
    args: RangeSummaryArgs,
    recording: boolean
  ): RangeSummaryResult;
  /** Remember an HMR-incompatibility notice, capped. */
  pushHmrIncompatibility(event: HmrIncompatibilityEvent): void;
  hmrIncompatibilities(): HmrIncompatibilityEvent[];
  /**
   * Remember a successful HMR patch, capped. Fills `file` from the cached
   * component tree when the page did not send one.
   */
  pushHmrPatch(event: HmrPatchEvent): void;
  hmrPatches(): HmrPatchEvent[];
  /** Patches and incompatibilities as one list, oldest first. */
  hmrHistory(): HmrHistoryEntry[];
  /** Fold a runtime inspector message into the caches. */
  applyInspector(message: InspectorMessage): void;
  /**
   * Forget what the previous page reported once another takes over: the
   * cached tree and details, and its HMR patches and failures.
   */
  forgetPage(): void;
  roots(): InspectorTreeNode[];
  details(id: number): InspectorDetails | null;
  /** The page runtime's last `ready` announcement; `ready: false` before it. */
  runtime(): LitRuntimeInfo;
  /**
   * The page whose traffic the session accepts. `undefined` until a runtime
   * announces itself with an id; a runtime without one (older plugin
   * version) leaves it undefined and is never filtered.
   */
  activePageId(): string | undefined;
  /** The tab the followed page runs in, when its runtime reported one. */
  activeTabId(): string | undefined;
  /**
   * Fold a runtime `ready`. Returns what happened so the caller can clear,
   * replay and notify: `'same'` (a reconnect of the active page -- keep the
   * buffer), `'first'` (no page was active), `'switched'` (a different page
   * took over) or `'legacy'` (no id -- behave as before).
   */
  pageReady(
    pageId: string | undefined,
    tabId?: string
  ): 'same' | 'first' | 'switched' | 'legacy';
  /** Whether a message stamped `pageId` belongs to the active page. */
  accepts(pageId: string | undefined): boolean;
  /** Everything a frozen panel needs, as of now. */
  capture(meta: {
    capturedAt: string;
    version: string;
    customLayers: readonly TimelineLayer[];
  }): SessionSnapshot;
}

/** Source file of the first node tagged `tagName`, depth-first. */
const sourceFileOf = (
  nodes: readonly InspectorTreeNode[],
  tagName: string
): string | undefined => {
  for (const node of nodes) {
    if (node.tagName === tagName && node.source) return node.source.file;
    const nested = sourceFileOf(node.children, tagName);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

/** Drop the oldest entries so `items` holds at most `max`. */
export const capTail = <T>(items: T[], max: number): void => {
  if (items.length > max) items.splice(0, items.length - max);
};

/**
 * Events from the last `sinceMs`, measured against the newest event of the
 * whole `buffer` rather than of `events`: an element that last rendered 10s
 * ago must come back empty for `sinceMs: 1000`, not report its own stale
 * events as recent. `sinceMs` is a duration on the page's recording clock,
 * which has no relation to this process's wall clock.
 */
export const sinceWindow = <T extends TimelineEvent>(
  events: T[],
  buffer: readonly TimelineEvent[],
  sinceMs: number | undefined
): T[] => {
  if (sinceMs === undefined || buffer.length === 0) return events;
  const cutoff = buffer[buffer.length - 1]!.time - sinceMs;
  return events.filter((e) => e.time >= cutoff);
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createRecordingSession(
  options: RecordingSessionOptions = {}
): RecordingSession {
  const {replay} = options;
  const epoch = options.epoch ?? Date.now().toString(36);
  let seq = 0;
  let wasRecording = options.recording ?? false;
  let activePage: string | undefined;
  let activeTab: string | undefined;

  // A plain array, not devframe's internal per-stream replay buffer, which
  // devframe marks `@internal` (see plans/devtools-features.md).
  const events: TimelineEvent[] = replay ? [...replay.events] : [];
  const hmr: HmrIncompatibilityEvent[] = replay
    ? [...replay.hmrIncompatibilities]
    : [];
  const patches: HmrPatchEvent[] = replay?.hmrPatches
    ? [...replay.hmrPatches]
    : [];
  let roots: InspectorTreeNode[] = replay ? [...replay.roots] : [];
  let runtime: LitRuntimeInfo = {
    ready: false,
    litPackages: {},
    topFrame: true,
    chromeTracks: true,
  };
  const details = new Map<number, InspectorDetails>(
    replay?.details.map((d) => [d.id, d])
  );

  return {
    push(incoming) {
      const stamped = incoming.map((event) => ({
        ...event,
        id: event.id ?? `${epoch}-${seq++}`,
      }));
      events.push(...stamped);
      capTail(events, RECENT_EVENTS_BUFFER_SIZE);
      return stamped;
    },
    clear() {
      events.length = 0;
    },
    setRecording(recording) {
      if (recording && !wasRecording) events.length = 0;
      wasRecording = recording;
    },
    history: () => [...events],
    query(args, recording) {
      let filtered: TimelineEvent[] = events;
      if (args.layerId !== undefined) {
        filtered = filtered.filter((e) => e.layerId === args.layerId);
      }
      if (args.elementId !== undefined) {
        filtered = filtered.filter((e) => e.meta?.elementId === args.elementId);
      }
      if (args.tagName !== undefined) {
        const wanted = args.tagName.toLowerCase();
        filtered = filtered.filter(
          (e) => e.meta?.tagName?.toLowerCase() === wanted
        );
      }
      filtered = sinceWindow(filtered, events, args.sinceMs);
      // A frozen session's panel reads the baked no-argument call, so the
      // agent-friendly 50/200 window would silently cut an export to its
      // last 25 spans -- and a link to anything older would miss.
      const limit = replay
        ? Math.min(
            args.limit ?? RECENT_EVENTS_BUFFER_SIZE,
            RECENT_EVENTS_BUFFER_SIZE
          )
        : Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const page = filtered.slice(-limit);
      return {
        recording,
        events: page,
        bufferSize: events.length,
        truncated: page.length < filtered.length,
      };
    },
    summarize(args, recording) {
      const windowed = sinceWindow(events, events, args.sinceMs);
      let cycles = updateCycles(windowed);
      if (args.tagName !== undefined) {
        cycles = cycles.filter((c) => c.tagName === args.tagName);
      }
      // Totals cover the whole window; only the per-cycle list is capped, so
      // a limit never silently understates a hot component.
      const components = rollup(cycles);
      const limited = cycles.slice(
        -Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      );
      return {
        recording,
        components,
        cycles: limited,
        bufferSize: events.length,
        truncated: limited.length < cycles.length,
      };
    },
    summarizeRange(args, recording) {
      const range = normalizeRange(args.start, args.end);
      if (range === null) {
        throw new Error(
          'range-summary needs two different finite times, start and end, in the milliseconds recent-events reports.'
        );
      }
      return {
        recording,
        bufferSize: events.length,
        ...summarizeRange(toSpans(events), range),
      };
    },
    pushHmrIncompatibility(event) {
      hmr.push(event);
      capTail(hmr, MAX_HMR_INCOMPATIBILITIES);
    },
    hmrIncompatibilities: () => [...hmr],
    pushHmrPatch(event) {
      const file = event.file ?? sourceFileOf(roots, event.tagName);
      patches.push(file === undefined ? event : {...event, file});
      capTail(patches, MAX_HMR_PATCHES);
    },
    hmrPatches: () => [...patches],
    // Patches go first so that, the sort being stable, a tie keeps them
    // ahead of an incompatibility reported in the same millisecond.
    hmrHistory: () =>
      [
        ...patches.map((patch): HmrHistoryEntry => ({
          kind: 'patched',
          at: patch.at,
          patch,
        })),
        ...hmr.map((incompatibility): HmrHistoryEntry => ({
          kind: 'incompatible',
          at: incompatibility.time,
          incompatibility,
        })),
      ].sort((a, b) => a.at - b.at),
    applyInspector(message) {
      if (message.type === 'tree') {
        roots = message.roots;
      } else if (message.type === 'details') {
        details.set(message.details.id, message.details);
      } else if (message.type === 'gone') {
        details.delete(message.id);
      } else if (message.type === 'ready') {
        runtime = {
          ready: true,
          litPackages: Object.fromEntries(
            Object.entries(message.litPackages ?? {}).map(([k, v]) => [
              k,
              [...v],
            ])
          ),
          topFrame: message.topFrame ?? true,
          chromeTracks: message.chromeTracks ?? true,
        };
      }
    },
    forgetPage() {
      roots = [];
      details.clear();
      patches.length = 0;
      hmr.length = 0;
    },
    roots: () => roots,
    runtime: () => runtime,
    details: (id) => details.get(id) ?? null,
    activePageId: () => activePage,
    activeTabId: () => activeTab,
    pageReady(pageId, tabId) {
      if (pageId === undefined) return 'legacy';
      if (pageId === activePage) return 'same';
      activeTab = tabId;
      const outcome = activePage === undefined ? 'first' : 'switched';
      activePage = pageId;
      return outcome;
    },
    // Unstamped traffic is an older runtime, and stamped traffic that beats
    // its page's `ready` to the node has no active page to be compared
    // with; both are let through rather than guessed at.
    accepts: (pageId) =>
      pageId === undefined || activePage === undefined || pageId === activePage,
    capture: (meta) => ({
      capturedAt: meta.capturedAt,
      version: meta.version,
      customLayers: [...meta.customLayers],
      roots,
      details: [...details.values()],
      events: [...events],
      hmrIncompatibilities: [...hmr],
      hmrPatches: [...patches],
    }),
  };
}
