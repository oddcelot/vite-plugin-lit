/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

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
} from '../../types/inspector.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import type {ComponentRollup, UpdateCycle} from '../timeline/derive.js';

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
 * Cap on the node-side recent-events ring buffer, matching the timeline
 * stream's own `replayWindow` so an agent and a (re)connecting panel see
 * comparable history.
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

/** Bare name of the `update-summary` query. */
export const RPC_UPDATE_SUMMARY = 'update-summary';

/** Bare name of the `inspect` action. */
export const RPC_INSPECT = 'inspect';

/** Bare name of the `set-recording` action. */
export const RPC_SET_RECORDING = 'set-recording';

/** Bare name of the `toggle-layer` action. */
export const RPC_TOGGLE_LAYER = 'toggle-layer';

/** Bare name of the `set-settings-override` action. */
export const RPC_SET_SETTINGS_OVERRIDE = 'set-settings-override';

/** Freeze the current session into a static panel directory. */
export const RPC_EXPORT_SNAPSHOT = 'export-snapshot';

/** Arguments for {@link RPC_EXPORT_SNAPSHOT}. */
export interface ExportSnapshotArgs {
  /**
   * Where to write. Relative paths resolve against the dev server's cwd.
   * Defaults to `lit-devtools-snapshot`.
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

/** Bare name of the `hmr-incompatible` client (node → panel) event. */
export const RPC_HMR_INCOMPATIBLE = 'hmr-incompatible';

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

/** Result of the `get-meta` query. */
export interface LitGetMetaResult {
  version: string;
  /** Built-in layers followed by any runtime-announced custom ones. */
  layers: TimelineLayer[];
  features: FeatureSettings | null;
  /** Channel and id to pass to `rpc.streaming.subscribe()`. */
  stream: {channel: string; id: string};
}

/** Argument of the `component-details` query. */
export interface ComponentDetailsArgs {
  id: number;
}

/** Argument of the `recent-events` query. */
export interface RecentEventsArgs {
  layerId?: string;
  elementId?: number;
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
    mouse: 'mouseEventEnabled',
    keyboard: 'keyboardEventEnabled',
  };

// Hand-typed rather than derived through `RpcDefinitionsToFunctionsWithNamespace`
// (also exported by `devframe/rpc`): the definitions themselves live in
// definition.ts next to their handlers, and hand-typing here avoids a
// value-level dependency from this shared-contract module back onto it.
declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'lit:get-meta': () => Promise<LitGetMetaResult>;
    'lit:list-components': () => Promise<InspectorTreeNode[]>;
    'lit:component-details': (
      args: ComponentDetailsArgs
    ) => Promise<InspectorDetails | null>;
    'lit:recent-events': (
      args?: RecentEventsArgs
    ) => Promise<RecentEventsResult>;
    'lit:update-summary': (
      args?: UpdateSummaryArgs
    ) => Promise<UpdateSummaryResult>;
    'lit:inspect': (command: InspectorCommand) => Promise<void>;
    'lit:set-recording': (args: SetRecordingArgs) => Promise<void>;
    'lit:toggle-layer': (args: ToggleLayerArgs) => Promise<void>;
    'lit:set-settings-override': (override: SettingsOverride) => Promise<void>;
    'lit:export-snapshot': (
      args: ExportSnapshotArgs
    ) => Promise<ExportSnapshotResult>;
    'lit:hmr-incompatibilities': () => Promise<HmrIncompatibilityEvent[]>;
  }

  interface DevframeRpcClientFunctions {
    'lit:inspector-message': (message: InspectorMessage) => void;
    'lit:hmr-incompatible': (event: HmrIncompatibilityEvent) => void;
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
    };
  }
}
