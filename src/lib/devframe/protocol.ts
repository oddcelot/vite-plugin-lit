/**
 * Shared wire contract between the Lit devframe's node-side definition
 * ({@link ../definition.ts}) and its panel: shared-state / streaming /
 * RPC-function names, their payload shapes, and the `devframe` registry
 * augmentations that type them end to end.
 *
 * @see plans/devframe-foundation.md
 */

import {DEFAULT_LAYERS_STATE} from '../../types/timeline.js';
import type {
  FeatureSettings,
  OverrideBaselines,
  SettingsOverride,
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorMessage,
  InspectorTreeNode,
  LitPackageVersions,
} from '../../types/inspector.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import type {HmrPatchEvent} from '../../types/hmr-patch.js';
import type {ComponentRollup, UpdateCycle} from '../timeline/derive.js';
import type {RangeSummary} from '../timeline/range.js';

/** The devframe's scope id. RPC names become `lit:*`, MCP wire names `lit_*`. */
export const LIT_DEVFRAME_ID = 'lit';

/** Shared-state key holding the {@link SessionState} snapshot. */
export const SESSION_STATE_KEY = 'session';

/** Streaming channel name the timeline event batches are pushed on. */
export const TIMELINE_STREAM_NAME = 'timeline';

/**
 * Id of the one long-lived timeline stream. Fixed rather than discovered:
 * there is exactly one page feed per dev session, so the panel can subscribe
 * without a round trip to look the id up. The node side re-`start()`s this id
 * if the transport dropped the stream after the last subscriber left.
 */
export const TIMELINE_STREAM_ID = 'live';

/**
 * Cap on the node-side recent-events ring buffer. It is also the history a
 * (re)connecting panel is seeded with (see {@link RPC_TIMELINE_HISTORY}).
 */
export const RECENT_EVENTS_BUFFER_SIZE = 512;

/** Bare (unscoped) name of the `get-meta` query. */
export const RPC_GET_META = 'get-meta';

/** Bare name of the `list-components` query. */
export const RPC_LIST_COMPONENTS = 'list-components';

/** Bare name of the `component-details` query. */
export const RPC_COMPONENT_DETAILS = 'component-details';

/** Bare name of the `recent-events` query. */
export const RPC_RECENT_EVENTS = 'recent-events';

/**
 * Bare name of the `timeline-history` query: the node's whole recent-events
 * buffer, oldest first, as `TimelineEvent[]`. What a live panel seeds itself
 * with on connect, since the stream only carries events from then on. Not
 * `recent-events`, whose live answer is filtered and capped for agents.
 */
export const RPC_TIMELINE_HISTORY = 'timeline-history';

/** Bare name of the `update-summary` query. */
export const RPC_UPDATE_SUMMARY = 'update-summary';

/** Bare name of the `range-summary` query. */
export const RPC_RANGE_SUMMARY = 'range-summary';

/** Bare name of the `inspect` action. */
export const RPC_INSPECT = 'inspect';

/** Bare name of the `set-recording` action. */
export const RPC_SET_RECORDING = 'set-recording';

/** Bare name of the `toggle-layer` action. */
export const RPC_TOGGLE_LAYER = 'toggle-layer';

/** Bare name of the `set-settings-override` action. */
export const RPC_SET_SETTINGS_OVERRIDE = 'set-settings-override';

/** Bare name of the `open-source` action. */
export const RPC_OPEN_SOURCE = 'open-source';

/** Arguments for {@link RPC_OPEN_SOURCE}. */
export interface OpenSourceArgs {
  /**
   * The path as the panel has it: what the transform injected, so relative
   * to the Vite root (or absolute, when the file lives outside it).
   */
  file: string;
  line?: number;
  /** 1-based; the editor opens at the start of the line without one. */
  column?: number;
}

/** What {@link RPC_OPEN_SOURCE} reports back. */
export interface OpenSourceResult {
  /**
   * False when no open service is installed on the host, which is the
   * panel's cue to fall back to `/__lit-open-in-editor`. Also false when the
   * file is missing or outside the allowed roots; the endpoint refuses those
   * paths too.
   */
  opened: boolean;
}

/** Freeze the current session into a static panel directory. */
export const RPC_EXPORT_SNAPSHOT = 'export-snapshot';

/** Arguments for {@link RPC_EXPORT_SNAPSHOT}. */
export interface ExportSnapshotArgs {
  /**
   * Where to write. Relative paths resolve against the dev server's cwd,
   * and the result has to stay beneath it. Defaults to
   * `lit-devtools-snapshot`. An existing directory is only replaced when it
   * holds an earlier snapshot.
   */
  outDir?: string;
}

/** What {@link RPC_EXPORT_SNAPSHOT} reports back, for the panel to display. */
export interface ExportSnapshotResult {
  outDir: string;
  events: number;
  components: number;
  details: number;
}

/** Bare name of the `inspector-message` client (node → panel) event. */
export const RPC_INSPECTOR_MESSAGE = 'inspector-message';

/** Bare name of the `hmr-incompatibilities` query. */
export const RPC_HMR_INCOMPATIBILITIES = 'hmr-incompatibilities';

/** Bare name of the `hmr-history` query. */
export const RPC_HMR_HISTORY = 'hmr-history';

/** Bare name of the `hmr-incompatible` client (node → panel) event. */
export const RPC_HMR_INCOMPATIBLE = 'hmr-incompatible';

/** Bare name of the `hmr-patched` client (node → panel) event. */
export const RPC_HMR_PATCHED = 'hmr-patched';

/** One entry of the `hmr-history` result: a patch that landed, or one that could not. */
export type HmrHistoryEntry =
  | {kind: 'patched'; at: number; patch: HmrPatchEvent}
  | {
      kind: 'incompatible';
      at: number;
      incompatibility: HmrIncompatibilityEvent;
    };

/** Result of the `hmr-history` query. */
export interface HmrHistoryResult {
  /** Patches and incompatibilities merged, oldest first, each list capped at 50. */
  entries: HmrHistoryEntry[];
}

/** Bare name of the `page-changed` client (node → panel) event. */
export const RPC_PAGE_CHANGED = 'page-changed';

/** The page the session follows changed (another tab or frame took over). */
export interface PageChangedEvent {
  previousPageId: string;
  pageId: string;
  /** The same tab reloaded, rather than another tab or frame opening. */
  reload: boolean;
  /** Wall-clock ms on the node side; for display only. */
  at: number;
}

/**
 * Bare name of the page-to-server event. A page runtime that is not on a Vite
 * dev server's HMR socket sends every channel message it would have sent over
 * `import.meta.hot` as `page-send(channel, data)`.
 */
export const RPC_PAGE_SEND = 'page-send';

/**
 * Bare name of the server-to-page client event, the reverse direction of
 * {@link RPC_PAGE_SEND}: `page-receive(channel, data)`. Broadcast to every
 * connected client and marked optional, since the panel does not register it.
 */
export const RPC_PAGE_RECEIVE = 'page-receive';

/**
 * Port message the browser extension's background sends a page when a panel
 * starts listening to it. The page's port is opened when the document loads,
 * usually long before DevTools is, so the relay's own `connected` has already
 * gone by; this one makes it say `connected` again (see
 * `runtime/window-transport.ts`) and the runtime re-announce itself to the new
 * panel. Never forwarded to the page as data.
 */
export const PEER_CONNECTED_CHANNEL = 'lit:peer-connected';

/**
 * Recording/layers snapshot shared between every surface (panel, page
 * runtime, MCP). Survives reconnect; mutated either by the `set-recording` /
 * `toggle-layer` actions below or directly by a panel through the generic
 * shared-state RPC devframe provides.
 *
 * `layers.recordingState` is the single authority for "is recording" — the
 * runtime's own layer state carries it, so a separate flag here would be a
 * second copy to keep in sync.
 */
export interface SessionState {
  layers: TimelineLayersState;
  /** Layers announced at runtime by app code through `addTimelineLayer()`. */
  customLayers: TimelineLayer[];
}

export const DEFAULT_SESSION_STATE: SessionState = {
  layers: DEFAULT_LAYERS_STATE,
  customLayers: [],
};

/** What the page runtime last announced about itself in its `ready` message. */
export interface LitRuntimeInfo {
  /**
   * False until a runtime has connected to this dev server, which is how the
   * panel tells "no components" from "no runtime".
   */
  ready: boolean;
  /**
   * Loaded versions per Lit package (`lit-html`, `lit-element`,
   * `@lit/reactive-element`); more than one entry for a package means
   * duplicate copies.
   */
  litPackages: LitPackageVersions;
  /** False when the runtime runs inside an iframe. */
  topFrame: boolean;
  /**
   * False when the page's browser ignores the Chrome Performance tracks
   * (Chrome before 134, Firefox, Safari). True until a runtime says
   * otherwise, so an older runtime keeps the switch usable.
   */
  chromeTracks: boolean;
}

/**
 * What the host behind this panel can actually do. The same panel runs under
 * the Vite plugin, `lit-devtools dev`, the browser extension (no server at
 * all) and a frozen snapshot, and a control whose host can't serve it can
 * only fail; the panel reads these to leave such controls out. Flat booleans
 * on purpose: each one answers "show this or not".
 */
export interface LitCapabilities {
  /**
   * Source locations open in the developer's editor: the host has the open
   * service and knows where the app's files live.
   */
  openInEditor: boolean;
  /** `export-snapshot` can write a directory to disk (a node host). */
  exportSnapshot: boolean;
  /** Plugin settings resolved from Vite config and env exist to show. */
  pluginSettings: boolean;
  /** Vite hot-patches components, so HMR history and notices can occur. */
  hmr: boolean;
  /**
   * The Vite transform stamps components with `ElementSource` file and line;
   * without it, details and spans carry no `source`.
   */
  sourceLocations: boolean;
}

/** Result of the `get-meta` query. */
export interface LitGetMetaResult {
  version: string;
  /** Built-in layers followed by any runtime-announced custom ones. */
  layers: TimelineLayer[];
  features: FeatureSettings | null;
  /** Whether the page can pick an element for the Components tab. */
  picker: boolean;
  /** What the page runtime last announced; see {@link LitRuntimeInfo}. */
  runtime: LitRuntimeInfo;
  /** Channel and id to pass to `rpc.streaming.subscribe()`. */
  stream: {channel: string; id: string};
  /** The page the session follows; absent until a runtime has announced itself. */
  activePageId?: string;
  /** What this host can do; see {@link LitCapabilities}. */
  capabilities: LitCapabilities;
}

/** Argument of the `list-components` query. */
export interface ListComponentsArgs {
  /**
   * Levels of the tree to return: 1 is the roots only. Nodes cut off by the
   * limit carry `hiddenChildren`. Omit for the whole tree.
   */
  maxDepth?: number;
}

/**
 * Argument of the `component-details` query: one element, or every element
 * of a tag.
 */
export type ComponentDetailsArgs =
  | {id: number}
  | {
      /** Case-insensitive tag name, e.g. `todo-item`. */
      tagName: string;
      /** Most matches returned. Default 20, hard ceiling 50. */
      limit?: number;
    };

/** Result of `component-details` when called with `tagName`. */
export interface ComponentDetailsByTagResult {
  /** Details of matching elements, in tree (depth-first) order. */
  details: InspectorDetails[];
  /**
   * Ids of matching elements whose details could not be read: the page
   * reported them gone, or nothing answered and none were cached.
   */
  missing: number[];
  /** True if more elements matched than `limit` allowed. */
  truncated: boolean;
}

/** Argument of the `recent-events` query. */
export interface RecentEventsArgs {
  layerId?: string;
  elementId?: number;
  /** Only events of elements with this tag name (case-insensitive). */
  tagName?: string;
  /**
   * Only events from the last `sinceMs` milliseconds, measured against
   * the newest event currently in the buffer — not wall-clock time.
   * `TimelineEvent.time` is "ms since recording started" in the page
   * (see `runtime/timeline/clock.ts`), which has no fixed relationship
   * to this process's clock.
   */
  sinceMs?: number;
  /** Default 50, hard ceiling 200 regardless of what's requested. */
  limit?: number;
}

/** Result of the `recent-events` query. */
export interface RecentEventsResult {
  /** Whether the timeline is currently recording. */
  recording: boolean;
  /** Most recent events matching the filters, oldest first. */
  events: TimelineEvent[];
  /** Total events currently held in the ring buffer, before filtering. */
  bufferSize: number;
  /** True if filtering matched more events than were returned. */
  truncated: boolean;
}

/** Argument of the `update-summary` query. */
export interface UpdateSummaryArgs {
  /** Restrict to one component, by tag name. */
  tagName?: string;
  /** Same window semantics as {@link RecentEventsArgs.sinceMs}. */
  sinceMs?: number;
  /** Cycles returned (the component totals always cover the whole window).
   *  Default 50, hard ceiling 200. */
  limit?: number;
}

/** Result of the `update-summary` query. */
export interface UpdateSummaryResult {
  /** Whether the timeline is currently recording. */
  recording: boolean;
  /** Per-component totals over the window, slowest first. */
  components: ComponentRollup[];
  /** The most recent update cycles in the window, oldest first. */
  cycles: UpdateCycle[];
  /** Total events currently held in the ring buffer, before derivation. */
  bufferSize: number;
  /** True if more cycles were derived than were returned. */
  truncated: boolean;
}

/** Argument of the `range-summary` query. */
export interface RangeSummaryArgs {
  /**
   * Start of the window, in `TimelineEvent.time` milliseconds: the same
   * clock `recent-events` returns, so an agent can pass times it saw. The
   * panel's own range selection lives in the browser and is not read here.
   */
  start: number;
  /** End of the window; the two may come in either order. */
  end: number;
}

/**
 * Result of the `range-summary` query: what happened between two instants,
 * counting each span that *starts* inside the window once.
 */
export interface RangeSummaryResult extends RangeSummary {
  /** Whether the timeline is currently recording. */
  recording: boolean;
  /** Total events currently held in the ring buffer, before derivation. */
  bufferSize: number;
}

/** Argument of the `set-recording` action. */
export interface SetRecordingArgs {
  recording: boolean;
}

/** Argument of the `toggle-layer` action. */
export interface ToggleLayerArgs {
  layerId: string;
  enabled: boolean;
}

/**
 * Maps a {@link TimelineLayer.id} to the {@link TimelineLayersState} flag
 * that gates it. Custom layers have no flag and are always on.
 */
export const LAYER_FLAGS: Readonly<Record<string, keyof TimelineLayersState>> =
  {
    'lit-lifecycle': 'litLifecycleEnabled',
    'lit-render': 'litRenderEnabled',
    'lit-render-verbose': 'litRenderVerboseEnabled',
    'lit-changed-values': 'litChangedValuesEnabled',
    mouse: 'mouseEventEnabled',
    keyboard: 'keyboardEventEnabled',
    'custom-events': 'customEventsEnabled',
    'lit-warnings': 'litWarningsEnabled',
  };

// Hand-typed rather than derived through `RpcDefinitionsToFunctionsWithNamespace`
// (also exported by `devframe/rpc`): the definitions themselves live in
// definition.ts next to their handlers, and hand-typing here avoids a
// value-level dependency from this shared-contract module back onto it.
declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'lit:get-meta': () => Promise<LitGetMetaResult>;
    'lit:list-components': (
      args?: ListComponentsArgs
    ) => Promise<InspectorTreeNode[]>;
    'lit:component-details': (
      args: ComponentDetailsArgs
    ) => Promise<InspectorDetails | null | ComponentDetailsByTagResult>;
    'lit:recent-events': (
      args?: RecentEventsArgs
    ) => Promise<RecentEventsResult>;
    'lit:timeline-history': () => Promise<TimelineEvent[]>;
    'lit:update-summary': (
      args?: UpdateSummaryArgs
    ) => Promise<UpdateSummaryResult>;
    'lit:range-summary': (
      args: RangeSummaryArgs
    ) => Promise<RangeSummaryResult>;
    'lit:inspect': (command: InspectorCommand) => Promise<void>;
    'lit:set-recording': (args: SetRecordingArgs) => Promise<void>;
    'lit:toggle-layer': (args: ToggleLayerArgs) => Promise<void>;
    'lit:set-settings-override': (override: SettingsOverride) => Promise<void>;
    'lit:open-source': (args: OpenSourceArgs) => Promise<OpenSourceResult>;
    'lit:export-snapshot': (
      args: ExportSnapshotArgs
    ) => Promise<ExportSnapshotResult>;
    'lit:hmr-incompatibilities': () => Promise<HmrIncompatibilityEvent[]>;
    'lit:hmr-history': () => Promise<HmrHistoryResult>;
    'lit:page-send': (channel: string, data?: unknown) => void;
  }

  interface DevframeRpcClientFunctions {
    'lit:inspector-message': (message: InspectorMessage) => void;
    'lit:hmr-incompatible': (event: HmrIncompatibilityEvent) => void;
    'lit:hmr-patched': (event: HmrPatchEvent) => void;
    'lit:page-changed': (event: PageChangedEvent) => void;
    'lit:page-receive': (channel: string, data?: unknown) => void;
  }

  interface DevframeSettingsRegistry {
    lit: {
      /** Panel chrome preference. Mirrors `COLOR_SCHEME_LS_KEY`. */
      appearance?: 'auto' | 'dark' | 'light';
      /**
       * The Settings tab's live overrides, stored as one blob the way the
       * panel already treats them. Mirrors `SETTINGS_OVERRIDE_LS_KEY`, which
       * stays: the page runtime reads it synchronously at module-init time,
       * long before any client exists, and every settings-store read is
       * async by design.
       */
      override?: SettingsOverride;
      /**
       * The config value each overridden key was set against. A sibling of
       * `override` so the runtime never sees it. Mirrors
       * `OVERRIDE_BASELINES_LS_KEY`.
       */
      overrideBaselines?: OverrideBaselines;
    };
  }
}
