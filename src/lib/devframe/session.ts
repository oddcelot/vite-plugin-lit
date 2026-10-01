/**
 * The recording session behind the {@link TimelineSink}: ring buffers, event
 * id stamping, the rising-edge clear, the `sinceMs`/`limit` window and the
 * inspector caches. Plain state and pure queries -- no devframe, no Vite, no
 * streams -- so `definition.ts` is left registering thin RPC adapters over it
 * and the window semantics can be unit-tested without booting anything.
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
import type {TimelineEvent, TimelineLayer} from '../../types/timeline.js';
import type {SessionSnapshot} from '../../types/snapshot.js';
import {rollup} from '../timeline/derive.js';
import {updateCycles} from '../timeline/model.js';
import {RECENT_EVENTS_BUFFER_SIZE} from './protocol.js';
import type {
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
  /** Remember an HMR-incompatibility notice, capped. */
  pushHmrIncompatibility(event: HmrIncompatibilityEvent): void;
  hmrIncompatibilities(): HmrIncompatibilityEvent[];
  /** Fold a runtime inspector message into the caches. */
  applyInspector(message: InspectorMessage): void;
  roots(): InspectorTreeNode[];
  details(id: number): InspectorDetails | null;
  /** Everything a frozen panel needs, as of now. */
  capture(meta: {
    capturedAt: string;
    version: string;
    customLayers: readonly TimelineLayer[];
  }): SessionSnapshot;
}

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

  // A plain array, not devframe's internal per-stream replay buffer, which
  // devframe marks `@internal` (see plans/devtools-features.md).
  const events: TimelineEvent[] = replay ? [...replay.events] : [];
  const hmr: HmrIncompatibilityEvent[] = replay
    ? [...replay.hmrIncompatibilities]
    : [];
  let roots: InspectorTreeNode[] = replay ? [...replay.roots] : [];
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
    pushHmrIncompatibility(event) {
      hmr.push(event);
      capTail(hmr, MAX_HMR_INCOMPATIBILITIES);
    },
    hmrIncompatibilities: () => [...hmr],
    applyInspector(message) {
      if (message.type === 'tree') {
        roots = message.roots;
      } else if (message.type === 'details') {
        details.set(message.details.id, message.details);
      } else if (message.type === 'gone') {
        details.delete(message.id);
      }
    },
    roots: () => roots,
    details: (id) => details.get(id) ?? null,
    capture: (meta) => ({
      capturedAt: meta.capturedAt,
      version: meta.version,
      customLayers: [...meta.customLayers],
      roots,
      details: [...details.values()],
      events: [...events],
      hmrIncompatibilities: [...hmr],
    }),
  };
}
