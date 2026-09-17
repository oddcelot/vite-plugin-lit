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

import {defineDevframe, defineRpcFunction} from 'devframe';
import type {DevframeDefinition, DevframeNodeContext} from 'devframe';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';
import {TIMELINE_LAYERS} from '../../types/timeline.js';
import {MAX_HMR_INCOMPATIBILITIES} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {LIT_LOGO_ICON} from './icon.js';
import {PANEL_DIST_DIR} from './paths.js';
import type {
  FeatureSettings,
  SettingsOverride,
  TimelineEvent,
} from '../../types/timeline.js';
import {
  DEFAULT_SESSION_STATE,
  LAYER_FLAGS,
  LIT_DEVFRAME_ID,
  RECENT_EVENTS_BUFFER_SIZE,
  RPC_COMPONENT_DETAILS,
  RPC_GET_META,
  RPC_HMR_INCOMPATIBILITIES,
  RPC_HMR_INCOMPATIBLE,
  RPC_INSPECT,
  RPC_INSPECTOR_MESSAGE,
  RPC_LIST_COMPONENTS,
  RPC_RECENT_EVENTS,
  RPC_SET_RECORDING,
  RPC_SET_SETTINGS_OVERRIDE,
  RPC_TOGGLE_LAYER,
  SESSION_STATE_KEY,
  TIMELINE_STREAM_ID,
  TIMELINE_STREAM_NAME,
  type ComponentDetailsArgs,
  type LitGetMetaResult,
  type RecentEventsArgs,
  type RecentEventsResult,
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
  /**
   * Directory holding the built panel SPA. Defaults to the package's own
   * `dist/client`; the dev-time panel build points it elsewhere.
   */
  clientAssets?: string;
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
    icon: LIT_LOGO_ICON,
    dock: {category: 'framework'},
    clientAssets: options.clientAssets ?? PANEL_DIST_DIR,

    async setup(ctx: DevframeNodeContext) {
      const my = ctx.scope(LIT_DEVFRAME_ID);

      // Bind the per-user settings store before any panel can connect.
      // Both sides build it lazily on first access, but only this one backs
      // it with a JSON file -- a client that asks first gets a plain
      // in-memory shared state instead, so the panel's preferences would
      // round-trip happily and then vanish on restart. The panel is the only
      // thing that reads or writes these (see `panel/devtools-settings.ts`);
      // this call exists purely to make them durable.
      await my.settings.global.all();

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

      // Bounded history for the `recent-events` agent query. A plain array,
      // not devframe's internal per-stream replay buffer, which devframe
      // marks `@internal` (see plans/roadmap/02-agent-timeline-access.md).
      const recentEvents: TimelineEvent[] = [];

      // Recent HMR-incompatibility notices, capped the same way
      // `runtime/timeline/transport.ts` caps its pending queue — a long
      // session with many failing edits must not grow this forever.
      const hmrIncompatibilities: HmrIncompatibilityEvent[] = [];

      // Terminal echo for an audience that only sees dev-server stdout (an
      // agent, or a CI log) and not the browser console or the panel.
      // Fire-and-log only — the cache above is the read-back store.
      const hmrDiagnostics = ctx.diagnostics.defineDiagnostics({
        docsBase:
          'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/',
        codes: {
          LIT_HMR_ACCESSOR: {
            why: (p: {tagName: string}) =>
              `<${p.tagName}> can't be hot-patched: standard accessor decorators`,
            docs: 'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/#cannot-be-patched-in-place',
          },
          LIT_HMR_PATCH_FAILED: {
            why: (p: {tagName: string; detail: string}) =>
              `<${p.tagName}> can't be hot-patched: ${p.detail}`,
            docs: 'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/#cannot-be-patched-in-place',
          },
          LIT_HMR_ATTRS_CHANGED: {
            why: (p: {tagName: string}) =>
              `<${p.tagName}> changed observedAttributes; reload recommended`,
            docs: 'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/#cannot-be-patched-in-place',
          },
        },
      });
      ctx.diagnostics.register(hmrDiagnostics);

      // Streaming/source wiring only makes sense for a live session: a
      // static build or MCP run has no page attached (its `source` is a
      // `createNullSource()`), and `ctx.mode` is 'build' there.
      if (ctx.mode === 'dev') {
        const channel = my.rpc.streaming.create<TimelineEvent[]>(
          TIMELINE_STREAM_NAME,
          {replayWindow: 512}
        );
        // Started eagerly, not on the first event: `streaming:subscribe` is
        // fire-and-forget on the wire, and a subscribe naming a stream id
        // that does not exist yet is dropped with a DF0030 diagnostic rather
        // than queued. The panel subscribes as soon as it connects, which is
        // normally long before the first event, so the stream has to be
        // there waiting. `??` covers a re-start if the transport aborted it
        // after the last subscriber left.
        channel.start({id: TIMELINE_STREAM_ID});
        const ensureStream = () =>
          channel.get(TIMELINE_STREAM_ID) ??
          channel.start({id: TIMELINE_STREAM_ID});

        source.attach({
          pushEvents(events) {
            if (events.length === 0) return;
            ensureStream().write(events);
            recentEvents.push(...events);
            if (recentEvents.length > RECENT_EVENTS_BUFFER_SIZE) {
              recentEvents.splice(
                0,
                recentEvents.length - RECENT_EVENTS_BUFFER_SIZE
              );
            }
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
            } else if (message.type === 'gone') {
              cachedDetails.delete(message.id);
            }
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_INSPECTOR_MESSAGE}`,
              args: [message],
              // A page can be open with no panel docked; the runtime keeps
              // answering either way, so a broadcast with no listener is
              // normal rather than a missing-function error.
              optional: true,
            });
          },
          runtimeReady() {
            // A new page means a new timeline clock: the runtime re-zeroes on
            // the rising edge below, so events kept from the previous document
            // would sit in the same buffer on a different time origin and make
            // `recent-events`' `sinceMs` window meaningless. They also describe
            // a page that no longer exists.
            recentEvents.length = 0;

            // Replay current state to a runtime that just booted from its
            // defaults. Unconditional: `setRecording(false)` on a fresh page
            // is a no-op.
            const {layers} = session.value();
            source.setLayers(layers);
            source.setRecording(layers.recordingState);
          },
          hmrIncompatible(event) {
            hmrIncompatibilities.push(event);
            if (hmrIncompatibilities.length > MAX_HMR_INCOMPATIBILITIES) {
              hmrIncompatibilities.splice(
                0,
                hmrIncompatibilities.length - MAX_HMR_INCOMPATIBILITIES
              );
            }
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_HMR_INCOMPATIBLE}`,
              args: [event],
              optional: true,
            });

            // Informational terminal echo, never a thrown error.
            if (event.reason.code === 'accessor-decorators') {
              hmrDiagnostics.LIT_HMR_ACCESSOR({tagName: event.tagName});
            } else if (event.reason.code === 'patch-failed') {
              hmrDiagnostics.LIT_HMR_PATCH_FAILED({
                tagName: event.tagName,
                detail: event.reason.detail,
              });
            } else {
              hmrDiagnostics.LIT_HMR_ATTRS_CHANGED({tagName: event.tagName});
            }
          },
        });

        // Single push point for recording/layer changes: fires for the
        // `set-recording` / `toggle-layer` actions below and for a panel
        // mutating shared state directly through devframe's generic
        // shared-state RPC. Immer only emits when the state reference
        // changes, so a no-op mutate sends nothing.
        session.on('updated', (state) => {
          source.setRecording(state.layers.recordingState);
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
            // `.value()` returns a deep-readonly snapshot; copy so callers
            // get a plain, mutable `TimelineLayer[]`.
            layers: [...TIMELINE_LAYERS, ...session.value().customLayers],
            features: features ? features() : null,
            stream: {
              channel: `${LIT_DEVFRAME_ID}:${TIMELINE_STREAM_NAME}`,
              id: TIMELINE_STREAM_ID,
            },
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
          name: RPC_HMR_INCOMPATIBILITIES,
          type: 'query',
          jsonSerializable: true,
          agent: {
            description:
              "List recent components the Lit plugin could not hot-patch in place, and why. Call this after an unexplained full-page reload during development, or when a component's state resets unexpectedly on edit.",
          },
          handler: async (): Promise<HmrIncompatibilityEvent[]> =>
            hmrIncompatibilities,
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
          name: RPC_RECENT_EVENTS,
          type: 'query',
          jsonSerializable: true,
          agent: {
            description:
              'Get recent timeline events (lifecycle, render, mouse, keyboard) to diagnose why a component re-rendered or updated. Call list-components first to find an element’s id, then filter by elementId to see just its events. Check the `recording` field in the response — if false, no events are being captured; ask the developer to enable Recording in the Timeline tab before retrying.',
          },
          // `args` is genuinely absent when an agent calls the tool with no
          // filters — the most common call — so it must default, not just be
          // typed optional.
          handler: async (
            args: RecentEventsArgs = {}
          ): Promise<RecentEventsResult> => {
            const recording = session.value().layers.recordingState;
            let filtered = recentEvents;
            if (args.layerId !== undefined) {
              filtered = filtered.filter((e) => e.layerId === args.layerId);
            }
            if (args.elementId !== undefined) {
              filtered = filtered.filter(
                (e) => e.meta?.elementId === args.elementId
              );
            }
            // Measured against the newest event in the whole buffer, not the
            // newest *matching* one: an element that last rendered 10s ago
            // must come back empty for `sinceMs: 1000`, not report its own
            // stale events as if they were recent.
            if (args.sinceMs !== undefined && recentEvents.length > 0) {
              const newest = recentEvents[recentEvents.length - 1]!.time;
              const cutoff = newest - args.sinceMs;
              filtered = filtered.filter((e) => e.time >= cutoff);
            }
            const limit = Math.min(args.limit ?? 50, 200);
            const events = filtered.slice(-limit);
            return {
              recording,
              events,
              bufferSize: recentEvents.length,
              truncated: events.length < filtered.length,
            };
          },
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_INSPECT,
          type: 'action',
          jsonSerializable: true,
          handler: async (command: InspectorCommand): Promise<void> => {
            // "Pick" starts the overlay's inspect picker, which the host
            // toggles in the page rather than answering from the runtime.
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
          // The one agent-exposed mutation. `recent-events` is a dead end
          // when recording is off, so an agent that can read the timeline
          // but never start it just hands the question back to the human.
          // Deliberately still the *only* one: the picker and layer toggles
          // stay panel-only.
          agent: {
            description:
              'Start or stop timeline recording. This is a shared toggle: turning it on also affects the DevTools panel if a developer has it open. Call this if lit:recent-events reports `recording: false`.',
          },
          handler: async (args: SetRecordingArgs): Promise<void> => {
            session.mutate((state) => {
              state.layers.recordingState = args.recording;
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
            const flag = LAYER_FLAGS[args.layerId];
            // Custom layers have no capture flag to toggle — app code owns
            // whether it emits at all.
            if (!flag) return;
            session.mutate((state) => {
              state.layers[flag] = args.enabled;
            });
          },
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_SET_SETTINGS_OVERRIDE,
          type: 'action',
          jsonSerializable: true,
          handler: async (override: SettingsOverride): Promise<void> => {
            source.setSettingsOverride(override);
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
