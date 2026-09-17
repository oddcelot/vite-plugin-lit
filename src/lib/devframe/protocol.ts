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
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorMessage,
  InspectorTreeNode,
} from '../../types/inspector.js';

/** The devframe's scope id. RPC names become `lit:*`, MCP wire names `lit_*`. */
export const LIT_DEVFRAME_ID = 'lit';

/** Shared-state key holding the {@link SessionState} snapshot. */
export const SESSION_STATE_KEY = 'session';

/** Streaming channel name the timeline event batches are pushed on. */
export const TIMELINE_STREAM_NAME = 'timeline';

/** Bare (unscoped) name of the `get-meta` query. */
export const RPC_GET_META = 'get-meta';

/** Bare name of the `list-components` query. */
export const RPC_LIST_COMPONENTS = 'list-components';

/** Bare name of the `component-details` query. */
export const RPC_COMPONENT_DETAILS = 'component-details';

/** Bare name of the `inspect` action. */
export const RPC_INSPECT = 'inspect';

/** Bare name of the `set-recording` action. */
export const RPC_SET_RECORDING = 'set-recording';

/** Bare name of the `toggle-layer` action. */
export const RPC_TOGGLE_LAYER = 'toggle-layer';

/** Bare name of the `inspector-message` client (node → panel) event. */
export const RPC_INSPECTOR_MESSAGE = 'inspector-message';

/**
 * Recording/layers snapshot shared between every surface (panel, page
 * runtime, MCP). Survives reconnect; mutated either by the `set-recording` /
 * `toggle-layer` actions below or directly by a panel through the generic
 * shared-state RPC devframe provides.
 */
export interface SessionState {
  recording: boolean;
  layers: TimelineLayersState;
  customLayers: TimelineLayer[];
}

export const DEFAULT_SESSION_STATE: SessionState = {
  recording: false,
  layers: DEFAULT_LAYERS_STATE,
  customLayers: [],
};

/** Result of the `get-meta` query. */
export interface LitGetMetaResult {
  version: string;
  layers: TimelineLayer[];
  features: FeatureSettings | null;
}

/** Argument of the `component-details` query. */
export interface ComponentDetailsArgs {
  id: number;
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
    'lit:inspect': (command: InspectorCommand) => Promise<void>;
    'lit:set-recording': (args: SetRecordingArgs) => Promise<void>;
    'lit:toggle-layer': (args: ToggleLayerArgs) => Promise<void>;
  }

  interface DevframeRpcClientFunctions {
    'lit:inspector-message': (message: InspectorMessage) => void;
  }

  interface DevframeSettingsRegistry {
    lit: {
      appearance?: 'auto' | 'dark' | 'light';
    };
  }
}
