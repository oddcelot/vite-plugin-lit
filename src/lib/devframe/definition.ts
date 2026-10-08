/**
 * The framework-neutral Lit devframe: RPC functions, shared state, and the
 * timeline stream. Talks to the page runtime only through the injected
 * {@link TimelineSource} port, so it runs unchanged under `createDevServer()`,
 * `createBuild()`, or an MCP server with no Vite in the loop. `vite.ts` wires
 * the real page-runtime bridge and mounts this via `createPluginFromDevframe`.
 *
 * Nothing reachable from here at module scope may import a `node:` module:
 * the definition also runs in a browser, with no server at all. Node-only
 * work (`open-source`, `export-snapshot`) imports what it needs inside its
 * handler, and a browser host never gets that far.
 *
 * @see plans/devframe-foundation.md
 */

import {defineDevframe, defineRpcFunction} from 'devframe';
// Type-only: brings in the service's `declare module 'devframe'`
// augmentation so `ctx.services.get()` types its API. Nothing is
// imported at runtime, and the service is consumed, never installed
// here -- a Vite hub already has it (see `panel/open-in-editor.ts`).
import type {} from '@devframes/service-open';
import type {DevframeDefinition, DevframeNodeContext} from 'devframe';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';
import {TIMELINE_LAYERS} from '../../types/timeline.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {LIT_LOGO_ICON} from './icon.js';
import type {
  FeatureSettings,
  SettingsOverride,
  TimelineEvent,
} from '../../types/timeline.js';
import {
  DEFAULT_SESSION_STATE,
  LAYER_FLAGS,
  LIT_DEVFRAME_ID,
  RPC_COMPONENT_DETAILS,
  RPC_GET_META,
  RPC_PAGE_CHANGED,
  RPC_HMR_HISTORY,
  RPC_HMR_INCOMPATIBILITIES,
  RPC_HMR_INCOMPATIBLE,
  RPC_HMR_PATCHED,
  RPC_INSPECT,
  RPC_INSPECTOR_MESSAGE,
  RPC_LIST_COMPONENTS,
  RPC_RECENT_EVENTS,
  RPC_TIMELINE_HISTORY,
  RPC_SET_RECORDING,
  RPC_EXPORT_SNAPSHOT,
  RPC_OPEN_SOURCE,
  RPC_SET_SETTINGS_OVERRIDE,
  RPC_TOGGLE_LAYER,
  RPC_UPDATE_SUMMARY,
  SESSION_STATE_KEY,
  TIMELINE_STREAM_ID,
  TIMELINE_STREAM_NAME,
  type ComponentDetailsArgs,
  type ComponentDetailsByTagResult,
  type HmrHistoryResult,
  type ListComponentsArgs,
  type LitGetMetaResult,
  type RecentEventsArgs,
  type RecentEventsResult,
  type SessionState,
  type ExportSnapshotArgs,
  type ExportSnapshotResult,
  type OpenSourceArgs,
  type OpenSourceResult,
  type SetRecordingArgs,
  type ToggleLayerArgs,
  type UpdateSummaryArgs,
  type UpdateSummaryResult,
} from './protocol.js';
import {hostProfile, type HostKind} from './host-profile.js';
import type {NodeActions} from './node-actions.js';
import {createInspectorQueries} from './inspector-queries.js';
import {createFollowedPage} from './followed-page.js';
import {createNullSource, type TimelineSource} from './source.js';
import type {SessionSnapshot} from '../../types/snapshot.js';

export interface CreateLitDevframeOptions {
  /** Page-runtime bridge. Use {@link createNullSource} when no page is attached. */
  source: TimelineSource;
  /** Plugin version, surfaced by `get-meta` and the devframe's own `version`. */
  version: string;
  /** Resolved feature settings, surfaced by `get-meta`. */
  features?: () => FeatureSettings | null;
  /**
   * Which host this runs on; decides the picker and what `get-meta` reports
   * the host can do. See `host-profile.ts`.
   */
  host: HostKind;
  /**
   * Directory holding the built panel SPA, for hosts that serve it. No
   * default here: resolving the package's own `dist/client` takes `node:fs`,
   * and this module also has to load in a browser bundle (a host with no
   * dev server, where the panel is already the page). Node hosts pass
   * `PANEL_DIST_DIR` from `paths.ts` themselves.
   */
  clientAssets?: string;
  /**
   * Opening files in an editor and writing snapshots to disk. Only Node
   * hosts pass these (see `node-actions.ts`); without them `open-source`
   * opens nothing and `export-snapshot` is unavailable.
   */
  nodeActions?: NodeActions;
  /**
   * Boot from a recorded session instead of a live one. Set only by the
   * static-snapshot build (see `lib/snapshot.ts`): the caches below start
   * populated, so the frozen panel has a timeline and a component tree to
   * render with no page and no dev server behind it.
   */
  replay?: SessionSnapshot;
  /**
   * How long `list-components` and `component-details` wait for the page
   * before answering from the cache. Short on purpose: the null source never
   * answers, and an agent call must not hang. Tests lower it.
   */
  inspectorTimeoutMs?: number;
}

const DEFAULT_INSPECTOR_TIMEOUT_MS = 500;

/**
 * Builds the Lit devframe definition. Framework-neutral: everything here
 * runs the same whether the host is Vite (`vite.ts`), a standalone dev
 * server, a static build, or an MCP server.
 */
export function createLitDevframe(
  options: CreateLitDevframeOptions
): DevframeDefinition {
  const {source, version, features, replay, host, nodeActions} = options;

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
    clientAssets: options.clientAssets,

    // `component-details` takes an id, so `snapshot: true` (which bakes the
    // no-argument call) cannot express it. Bake one record per component the
    // session actually opened -- the only ids that have details to freeze.
    rpc: replay
      ? {
          snapshot: [
            {
              method: `${LIT_DEVFRAME_ID}:${RPC_COMPONENT_DETAILS}`,
              inputs: replay.details.map((d) => [{id: d.id}]),
            },
          ],
        }
      : undefined,

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
          initialValue: replay
            ? {
                ...DEFAULT_SESSION_STATE,
                // Recorded events carry layer ids; without the custom layers
                // that produced them the frozen panel would show a filter it
                // cannot name.
                customLayers: replay.customLayers,
              }
            : DEFAULT_SESSION_STATE,
        }
      );

      const live = ctx.mode === 'dev' && replay === undefined;

      // Read per call: the plugin's settings are only resolved once its
      // config is, which can be after this setup has run.
      const profile = () =>
        hostProfile(host, {
          live,
          features: features ? features() : undefined,
          nodeActions: nodeActions !== undefined,
          recorded: replay?.capabilities,
        });
      // The agent's component queries ask the page, falling back to what the
      // followed page cached.
      const queries = createInspectorQueries({
        source,
        cache: {
          roots: () => followed.roots(),
          details: (id) => followed.details(id),
        },
        live,
        timeoutMs: options.inspectorTimeoutMs ?? DEFAULT_INSPECTOR_TIMEOUT_MS,
      });

      // Terminal echo for an audience that only sees dev-server stdout (an
      // agent, or a CI log) and not the browser console or the panel.
      // Fire-and-log only — the session is the read-back store.
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

      // The stream only exists in a live session; nothing reaches the sink
      // otherwise, so nothing writes before the dev branch below wires it.
      let writeEvents: (stamped: TimelineEvent[]) => void = () => {};

      // Everything the page tells us -- events, inspector answers, HMR
      // notices -- is held by the followed page; the RPC functions below are
      // thin adapters over it. Pre-filled when replaying: there is no page to
      // ask. Its effects are where page traffic turns into broadcasts to the
      // panel, shared state and terminal diagnostics.
      const followed = createFollowedPage({
        replay,
        requester: queries,
        runtime: source,
        layers: () => session.value().layers,
        effects: {
          events: (stamped) => writeEvents(stamped),
          layerAdded(layer) {
            session.mutate((state) => {
              if (
                !state.customLayers.some((existing) => existing.id === layer.id)
              ) {
                state.customLayers.push(layer);
              }
            });
          },
          inspectorMessage(message) {
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_INSPECTOR_MESSAGE}`,
              args: [message],
              // A page can be open with no panel docked; the runtime keeps
              // answering either way, so a broadcast with no listener is
              // normal rather than a missing-function error.
              optional: true,
            });
          },
          pageChanged(change) {
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_PAGE_CHANGED}`,
              args: [change],
              optional: true,
            });
          },
          hmrPatched(event) {
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_HMR_PATCHED}`,
              args: [event],
              optional: true,
            });
          },
          hmrIncompatible(event) {
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_HMR_INCOMPATIBLE}`,
              args: [event],
              optional: true,
            });
          },
          diagnose(diagnostic) {
            const {code, ...params} = diagnostic;
            (hmrDiagnostics[code] as (p: typeof params) => void)(params);
          },
          readOverride: async () =>
            (await my.settings.global.get('override')) as
              | SettingsOverride
              | undefined,
        },
      });

      // Streaming/source wiring only makes sense for a live session: a
      // static build or MCP run has no page attached (its `source` is a
      // `createNullSource()`), and `ctx.mode` is 'build' there.
      if (ctx.mode === 'dev') {
        // No `replayWindow`: a subscriber would be replayed the whole buffer
        // in separate chunks, including batches from before the last
        // recording started (a different clock) and ones the panel's Clear
        // dropped, and the node has no way to forget them. A connecting panel
        // is seeded from `timeline-history` instead, which is the session buffer,
        // cleared on the same edges.
        const channel =
          my.rpc.streaming.create<TimelineEvent[]>(TIMELINE_STREAM_NAME);
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

        writeEvents = (stamped) => ensureStream().write(stamped);
        source.attach(followed.sink);

        // Single push point for recording/layer changes: fires for the
        // `set-recording` / `toggle-layer` actions below and for a panel
        // mutating shared state directly through devframe's generic
        // shared-state RPC. Immer only emits when the state reference
        // changes, so a no-op mutate sends nothing.
        session.on('updated', (state) => followed.layersChanged(state.layers));
      }

      my.rpc.register(
        defineRpcFunction({
          name: RPC_GET_META,
          type: 'query',
          jsonSerializable: true,
          snapshot: true,
          agent: {
            description:
              'Get the plugin version, active timeline layers, resolved feature settings, and the capabilities of the host (whether it can open files in an editor, export a snapshot, hot-patch components). Call once at the start of a session to learn what timeline layers exist before asking about events.',
          },
          handler: async (): Promise<LitGetMetaResult> => ({
            version,
            // `.value()` returns a deep-readonly snapshot; copy so callers
            // get a plain, mutable `TimelineLayer[]`.
            layers: [...TIMELINE_LAYERS, ...session.value().customLayers],
            features: features ? features() : null,
            picker: profile().picker,
            runtime: followed.runtime(),
            stream: {
              channel: `${LIT_DEVFRAME_ID}:${TIMELINE_STREAM_NAME}`,
              id: TIMELINE_STREAM_ID,
            },
            activePageId: followed.activePageId(),
            capabilities: profile().capabilities,
          }),
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_LIST_COMPONENTS,
          type: 'query',
          jsonSerializable: true,
          // Baked into a static snapshot: takes no required arguments, and
          // by export time its answer is exactly what the session recorded.
          snapshot: true,
          agent: {
            description:
              'List the live Lit component tree of the inspected page, read from the page on each call. Call this to find an element id, or to see how components nest. Nodes carry source (where the class is declared) and, when known, callSite (where the instance is written in an html template). A tag used on the page that no custom element defines (a missing import, a typo, a chunk not loaded yet) is listed in its place with notDefined: true and no source; it is not a Lit component. Pass maxDepth (1 = top-level components only) to bound a large tree: nodes cut off by it have empty children and carry hiddenChildren, the number of children dropped; omit it for the whole tree. If you already know the tag name, skip this and pass tagName to lit:component-details or lit:recent-events.',
          },
          // `args` is absent when called with no filters (the baked
          // snapshot call too), so it must default.
          handler: async (
            args: ListComponentsArgs = {}
          ): Promise<InspectorTreeNode[]> => queries.tree(args),
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_HMR_INCOMPATIBILITIES,
          type: 'query',
          jsonSerializable: true,
          // Baked into a static snapshot: takes no required arguments, and
          // by export time its answer is exactly what the session recorded.
          snapshot: true,
          agent: {
            description:
              "List recent components the Lit plugin could not hot-patch in place, and why. Call this after an unexplained full-page reload during development, or when a component's state resets unexpectedly on edit.",
          },
          handler: async (): Promise<HmrIncompatibilityEvent[]> =>
            followed.hmrIncompatibilities(),
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_HMR_HISTORY,
          type: 'query',
          jsonSerializable: true,
          // Baked into a static snapshot: takes no required arguments, and
          // by export time its answer is exactly what the session recorded.
          snapshot: true,
          agent: {
            description:
              'List recent hot-module-reload outcomes for Lit components, oldest first, up to 50 patches and 50 failures. Each entry is kind "patched" (an edit landed in place: instances updated, durationMs of the synchronous patch, and childState, what happened to re-created child elements) or kind "incompatible" (the component could not be patched, with the reason and whether the page reloaded). Call this after editing a component to check the change landed, or after a full-page reload to see what preceded it. Works without recording; the history survives page reloads.',
          },
          handler: async (): Promise<HmrHistoryResult> => ({
            entries: followed.hmrHistory(),
          }),
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_COMPONENT_DETAILS,
          type: 'query',
          jsonSerializable: true,
          agent: {
            description:
              'Get reactive properties, attributes, and internal state for components, read from the page on each call. Pass id for one element (find it with list-components); that form returns null if the element has left the page. Or pass tagName (for example "todo-item", case-insensitive) for every element of that tag, in tree order, at most limit (default 20, ceiling 50): it returns {details, missing, truncated}, where missing lists matching element ids whose details could not be read and truncated means more elements matched than limit. A tag with no elements returns empty lists, so several elements of one tag are all returned, not just the first. Each element carries source (where its class is declared) and, when known, callSite (the html template position that rendered this instance, with a column). Each element also carries extras when it has any: reactive controllers, @lit/task status and value, signals and plain instance fields. It carries warnings when Lit\'s dev build has warned about the component (code and message, such as change-in-update); a production build of Lit has none.',
          },
          handler: async (
            args: ComponentDetailsArgs
          ): Promise<InspectorDetails | null | ComponentDetailsByTagResult> =>
            queries.details(args),
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_RECENT_EVENTS,
          type: 'query',
          jsonSerializable: true,
          // Baked into a static snapshot: takes no required arguments, and
          // by export time its answer is exactly what the session recorded.
          snapshot: true,
          agent: {
            description:
              'Get recent timeline events (lifecycle, render, mouse, keyboard) to diagnose why a component re-rendered or updated. Filter by tagName to see one component type’s events, or by elementId (from list-components) for a single element. Check the `recording` field in the response — if false, no events are being captured; ask the developer to enable Recording in the Timeline tab before retrying.',
          },
          // `args` is genuinely absent when an agent calls the tool with no
          // filters — the most common call — so it must default, not just be
          // typed optional.
          handler: async (
            args: RecentEventsArgs = {}
          ): Promise<RecentEventsResult> => {
            return followed.query(args);
          },
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_TIMELINE_HISTORY,
          type: 'query',
          jsonSerializable: true,
          // Not agent-exposed (agents have `recent-events`) and not baked
          // into a snapshot (a frozen panel reads `recent-events`, which
          // answers a replayed session with its whole buffer). This is the
          // live panel's seed: the stream carries nothing from before a
          // panel subscribed, so a reloaded panel asks for it here.
          handler: async (): Promise<TimelineEvent[]> => followed.history(),
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_UPDATE_SUMMARY,
          type: 'query',
          jsonSerializable: true,
          // Baked into a static snapshot: takes no required arguments, and by
          // export time its answer is exactly what the session recorded.
          snapshot: true,
          agent: {
            description:
              'Explain component updates: which components re-rendered, how often, how long they took, and which reactive properties changed to cause each update. Prefer this over lit:recent-events for "why did this re-render" and "what is re-rendering too much" — it answers from the same recording without the caller having to pair start/end events itself. Filter to one component with tagName. If the Changed values layer is on, cycles also carry changedDetail (old/new previews per key) and components carry redundantChanges (keys that changed to a new reference with equal content). Check the `recording` field — if false, no events are being captured; call lit:set-recording first.',
          },
          // `args` is genuinely absent when an agent calls the tool with no
          // filters — the most common call — so it must default.
          handler: async (
            args: UpdateSummaryArgs = {}
          ): Promise<UpdateSummaryResult> => {
            return followed.summarize(args);
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

      my.rpc.register(
        defineRpcFunction({
          name: RPC_OPEN_SOURCE,
          type: 'action',
          jsonSerializable: true,
          // Not agent-exposed: it spawns a GUI process.
          handler: async (args: OpenSourceArgs): Promise<OpenSourceResult> => {
            if (nodeActions === undefined) return {opened: false};
            return nodeActions.openSource(args, {
              service: ctx.services.get('@devframes/service-open'),
              override: (await my.settings.global.get('override')) as
                | SettingsOverride
                | undefined,
            });
          },
        })
      );

      my.rpc.register(
        defineRpcFunction({
          name: RPC_EXPORT_SNAPSHOT,
          type: 'action',
          jsonSerializable: true,
          // Not agent-exposed. It writes a directory to the developer's disk,
          // which is not something a coding agent should be able to do behind
          // their back -- same reasoning as the other mutating actions.
          handler: async (
            args: ExportSnapshotArgs
          ): Promise<ExportSnapshotResult> => {
            if (nodeActions === undefined) {
              throw new Error(
                '[lit-devtools] export-snapshot: this host cannot write to disk'
              );
            }
            // Recorded so the frozen panel offers what this host did.
            const {hmr, sourceLocations} = profile().capabilities;
            return nodeActions.exportSnapshot(
              args,
              {
                ...followed.capture({
                  capturedAt: new Date().toISOString(),
                  version,
                  customLayers: session.value().customLayers,
                }),
                capabilities: {hmr, sourceLocations},
              },
              {
                features: features ? features() : null,
                clientAssets: options.clientAssets,
              }
            );
          },
        })
      );
    },
  });
}

export default createLitDevframe({
  host: 'none',
  source: createNullSource(),
  version: '0.0.0',
});
