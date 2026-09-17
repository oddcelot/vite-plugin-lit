/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The framework-neutral Lit devframe: RPC functions, shared state, and the
 * timeline stream. Talks to the page runtime only through the injected
 * {@link TimelineSource} port, so it runs unchanged under `createDevServer()`,
 * `createBuild()`, or an MCP server with no Vite in the loop. `vite.ts` wires
 * the real page-runtime bridge and mounts this via `createPluginFromDevframe`.
 *
 * @see plans/devframe-foundation.md
 */

import {fileURLToPath} from 'node:url';
import {defineDevframe, defineRpcFunction} from 'devframe';
import type {DevframeDefinition, DevframeNodeContext} from 'devframe';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';
import type {FeatureSettings} from '../../types/timeline.js';
import type {TimelineEvent} from '../../types/timeline.js';
import {
  DEFAULT_SESSION_STATE,
  LIT_DEVFRAME_ID,
  RPC_COMPONENT_DETAILS,
  RPC_GET_META,
  RPC_INSPECT,
  RPC_INSPECTOR_MESSAGE,
  RPC_LIST_COMPONENTS,
  RPC_SET_RECORDING,
  RPC_TOGGLE_LAYER,
  SESSION_STATE_KEY,
  TIMELINE_STREAM_NAME,
  type ComponentDetailsArgs,
  type LitGetMetaResult,
  type SessionState,
  type SetRecordingArgs,
  type ToggleLayerArgs,
} from './protocol.js';
import {createNullSource, type TimelineSource} from './source.js';

export interface CreateLitDevframeOptions {
  /** Page-runtime bridge. Use {@link createNullSource} when no page is attached. */
  source: TimelineSource;
  /** Plugin version, surfaced by `get-meta` and the devframe's own `version`. */
  version: string;
  /** Resolved feature settings, surfaced by `get-meta`. */
  features?: () => FeatureSettings | null;
}

/**
 * Builds the Lit devframe definition. Framework-neutral: everything here
 * runs the same whether the host is Vite (`vite.ts`), a standalone dev
 * server, a static build, or an MCP server.
 */
export function createLitDevframe(
  options: CreateLitDevframeOptions
): DevframeDefinition {
  const {source, version, features} = options;

  return defineDevframe({
    id: LIT_DEVFRAME_ID,
    name: 'Lit',
    description: 'Timeline recorder and component inspector for Lit apps.',
    version,
    packageName: '@oddsquad/vite-plugin-lit',
    homepage: 'https://oddcelot.github.io/vite-plugin-lit/',
    importMetaUrl: import.meta.url,
    icon: 'ph:fire-duotone',
    dock: {category: 'framework'},
    // TODO(phase 2): src/panel still serves its own hand-rolled HTML/SSE
    // shell. Once it migrates to `connectDevframe()` and builds with Vite,
    // point this at that build's `dist/client` output instead.
    clientAssets: fileURLToPath(new URL('../../panel', import.meta.url)),

    async setup(ctx: DevframeNodeContext) {
      const my = ctx.scope(LIT_DEVFRAME_ID);

      const session = await my.rpc.sharedState<SessionState>(
        SESSION_STATE_KEY,
        {
          initialValue: DEFAULT_SESSION_STATE,
        }
      );

      // Latest inspector snapshot, cached so a panel that (re)connects after
      // the runtime already answered can read it without round-tripping to
      // the page again.
      let cachedRoots: InspectorTreeNode[] = [];
      const cachedDetails = new Map<number, InspectorDetails>();

      // Streaming/source wiring only makes sense for a live session: a
      // static build or MCP run has no page attached (its `source` is a
      // `createNullSource()`), and `ctx.mode` is 'build' there.
      if (ctx.mode === 'dev') {
        const stream = my.rpc.streaming.create<TimelineEvent[]>(
          TIMELINE_STREAM_NAME,
          {replayWindow: 512}
        );
        const timelineStream = stream.start();

        source.attach({
          pushEvents(events) {
            timelineStream.write(events);
          },
          addLayer(layer) {
            session.mutate((state) => {
              if (
                !state.customLayers.some((existing) => existing.id === layer.id)
              ) {
                state.customLayers.push(layer);
              }
            });
          },
          inspectorMessage(message) {
            if (message.type === 'tree') {
              cachedRoots = message.roots;
            } else if (message.type === 'details') {
              cachedDetails.set(message.details.id, message.details);
            }
            void my.rpc.broadcast({
              method: RPC_INSPECTOR_MESSAGE,
              args: [message],
            });
          },
        });

        // Single push point for recording/layer changes: fires for the
        // `set-recording` / `toggle-layer` actions below and for a panel
        // mutating shared state directly through devframe's generic
        // shared-state RPC. Immer only emits when the state reference
        // changes, so a no-op mutate sends nothing.
        session.on('updated', (state) => {
          source.setRecording(state.recording);
          source.setLayers(state.layers);
        });
      }

      my.rpc.register(
        defineRpcFunction({
          name: RPC_GET_META,
          type: 'query',
          jsonSerializable: true,
          snapshot: true,
          agent: {
            description:
              'Get the plugin version, active timeline layers, and resolved feature settings. Call once at the start of a session to learn what timeline layers exist before asking about events.',
          },
          handler: async (): Promise<LitGetMetaResult> => ({
            version,
            // `.value()` returns a deep-readonly snapshot; copy the array so
            // callers get a plain, mutable `TimelineLayer[]`.
            layers: [...session.value().customLayers],
            features: features ? features() : null,
          }),
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_LIST_COMPONENTS,
          type: 'query',
          jsonSerializable: true,
          agent: {
            description:
              'List the live Lit component tree of the inspected page. Call this before asking about a specific element to find its id.',
          },
          handler: async (): Promise<InspectorTreeNode[]> => cachedRoots,
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_COMPONENT_DETAILS,
          type: 'query',
          jsonSerializable: true,
          agent: {
            description:
              'Get reactive properties, attributes, and internal state for one component by id. Call list-components first to find the id.',
          },
          handler: async (
            args: ComponentDetailsArgs
          ): Promise<InspectorDetails | null> =>
            cachedDetails.get(args.id) ?? null,
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_INSPECT,
          type: 'action',
          jsonSerializable: true,
          handler: async (command: InspectorCommand): Promise<void> => {
            // "Pick" starts the overlay's inspect picker, a server-side
            // toggle, not a runtime query — see INSPECT_PATH's handling in
            // timeline-plugin.ts for the transport this mirrors.
            if (command.type === 'pick') {
              source.toggleOverlay();
              return;
            }
            source.sendInspector(command);
          },
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_SET_RECORDING,
          type: 'action',
          jsonSerializable: true,
          handler: async (args: SetRecordingArgs): Promise<void> => {
            session.mutate((state) => {
              state.recording = args.recording;
            });
          },
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_TOGGLE_LAYER,
          type: 'action',
          jsonSerializable: true,
          handler: async (args: ToggleLayerArgs): Promise<void> => {
            session.mutate((state) => {
              switch (args.layerId) {
                case 'lit-lifecycle':
                  state.layers.litLifecycleEnabled = args.enabled;
                  break;
                case 'lit-render':
                  state.layers.litRenderEnabled = args.enabled;
                  break;
                case 'mouse':
                  state.layers.mouseEventEnabled = args.enabled;
                  break;
                case 'keyboard':
                  state.layers.keyboardEventEnabled = args.enabled;
                  break;
                default:
                  break;
              }
            });
          },
        })
      );
    },
  });
}

export default createLitDevframe({
  source: createNullSource(),
  version: '0.0.0',
});
