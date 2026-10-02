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
import type {SourceLocator} from '../source-locator.js';
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
import {resolveLaunchEditor} from './launch-editor.js';
import {createInspectorRequester} from './inspector-request.js';
import {createRecordingSession, findByTag, pruneTree} from './session.js';
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
   * Whether the page has an element picker for the panel's Pick button.
   * Defaults to the source overlay being enabled, which is the Vite host's
   * picker; the standalone host ships one of its own.
   */
  picker?: () => boolean;
  /**
   * Directory holding the built panel SPA. Defaults to the package's own
   * `dist/client`; the dev-time panel build points it elsewhere.
   */
  clientAssets?: string;
  /**
   * Resolves the injected `ElementSource.file` paths for `open-source` and
   * confines opens to its roots (the Vite host's root and
   * `server.fs.allow`). Read per call, since a host only knows its roots once
   * its dev server is up. Without one, or before it has roots, the process's
   * working directory is the only root.
   */
  sourceLocator?: () => SourceLocator | undefined;
  /**
   * The editor key the developer named in config or env
   * (`sourceOverlay.editor`), or `undefined` when they never did. Read per
   * call. `open-source` maps it, or the panel's override of it, to a
   * `launch-editor` command; without either the editor is auto-detected.
   */
  configuredEditor?: () => string | undefined;
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
  const {source, version, features, replay, sourceLocator, configuredEditor} =
    options;
  const picker =
    options.picker ?? (() => features?.()?.sourceOverlay.enabled === true);

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

      // Everything the page tells us -- events, inspector answers, HMR
      // notices -- is held by the session; the RPC functions below are thin
      // adapters over it. Pre-filled when replaying: there is no page to ask.
      const recording = createRecordingSession({
        replay,
        recording: session.value().layers.recordingState,
      });

      // Lets the agent queries ask the page instead of trusting the cache,
      // which only holds what the panel last requested.
      const requester = createInspectorRequester(source);
      const live = ctx.mode === 'dev' && replay === undefined;
      const inspectorTimeout =
        options.inspectorTimeoutMs ?? DEFAULT_INSPECTOR_TIMEOUT_MS;

      // The cache only holds what the panel last asked for; an agent with no
      // panel open would otherwise read an empty tree from a live page.
      const currentRoots = async (): Promise<InspectorTreeNode[]> => {
        if (!live) return recording.roots();
        const roots = await requester.tree(inspectorTimeout);
        return roots ?? recording.roots();
      };

      // `null` is the page saying the element is gone; silence falls back to
      // the cache.
      const currentDetails = async (
        id: number
      ): Promise<InspectorDetails | null> => {
        if (!live) return recording.details(id);
        const fresh = await requester.details(id, inspectorTimeout);
        return fresh === undefined ? recording.details(id) : fresh;
      };

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

        source.attach({
          pushEvents(incoming, pageId) {
            if (!recording.accepts(pageId)) return;
            if (incoming.length === 0) return;
            ensureStream().write(recording.push(incoming));
          },
          addLayer(layer, pageId) {
            if (!recording.accepts(pageId)) return;
            session.mutate((state) => {
              if (
                !state.customLayers.some((existing) => existing.id === layer.id)
              ) {
                state.customLayers.push(layer);
              }
            });
          },
          inspectorMessage(message, pageId) {
            // Before the requester: an agent query must not be answered with
            // another tab's tree.
            if (!recording.accepts(pageId)) return;
            requester.resolve(message);
            recording.applyInspector(message);
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_INSPECTOR_MESSAGE}`,
              args: [message],
              // A page can be open with no panel docked; the runtime keeps
              // answering either way, so a broadcast with no listener is
              // normal rather than a missing-function error.
              optional: true,
            });
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
            if (
              outcome === 'switched' &&
              previous !== undefined &&
              pageId !== undefined
            ) {
              void ctx.rpc.broadcast({
                method: `${LIT_DEVFRAME_ID}:${RPC_PAGE_CHANGED}`,
                args: [
                  {
                    previousPageId: previous,
                    pageId,
                    reload: tabId !== undefined && tabId === previousTab,
                    at: Date.now(),
                  },
                ],
                optional: true,
              });
            }

            // Replay current state to a runtime that just booted from its
            // defaults. Unconditional: `setRecording(false)` on a fresh page
            // is a no-op.
            const {layers} = session.value();
            source.setLayers(layers);
            source.setRecording(layers.recordingState);

            // The runtime reads the panel's settings override from its own
            // localStorage at boot. That only works where the panel and the
            // app share an origin (the Vite hub); in standalone mode and on
            // per-port origins (StackBlitz) the page's localStorage never
            // holds it, so a reload would fall back to the config defaults.
            // The durable store has it, so replay from there. In the hub this
            // re-sends the values the page already read. Best-effort and
            // fire-and-forget: this handler is sync, and a missing override
            // or a failed read just leaves the runtime on its defaults.
            void my.settings.global
              .get('override')
              .then((override) => {
                if (override && Object.keys(override).length > 0) {
                  source.setSettingsOverride(override as SettingsOverride);
                }
              })
              .catch(() => {});
          },
          hmrPatched(event, pageId) {
            // Every open tab applies the same HMR patch; only the followed
            // page's counts.
            if (!recording.accepts(pageId)) return;
            recording.pushHmrPatch(event);
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_HMR_PATCHED}`,
              args: [event],
              optional: true,
            });
          },
          hmrIncompatible(event, pageId) {
            if (!recording.accepts(pageId)) return;
            recording.pushHmrIncompatibility(event);
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
        //
        // Clearing on the rising edge belongs here rather than in
        // `set-recording` for the same reason: the runtime re-zeroes its
        // timeline clock when recording turns on (`runtime/timeline/clock.ts`),
        // so events kept from the previous recording sit in the buffer on a
        // larger time origin than everything captured after them. A `sinceMs`
        // window reads them as the future, and pairing a start with its end
        // across the seam yields a negative duration. Same rationale as
        // `runtimeReady()` above, one level finer: a new clock, not a new page.
        session.on('updated', (state) => {
          const {recordingState} = state.layers;
          recording.setRecording(recordingState);
          source.setRecording(recordingState);
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
            picker: picker(),
            runtime: recording.runtime(),
            stream: {
              channel: `${LIT_DEVFRAME_ID}:${TIMELINE_STREAM_NAME}`,
              id: TIMELINE_STREAM_ID,
            },
            activePageId: recording.activePageId(),
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
              'List the live Lit component tree of the inspected page, read from the page on each call. Call this to find an element id, or to see how components nest. Pass maxDepth (1 = top-level components only) to bound a large tree: nodes cut off by it have empty children and carry hiddenChildren, the number of children dropped; omit it for the whole tree. If you already know the tag name, skip this and pass tagName to lit:component-details or lit:recent-events.',
          },
          // `args` is absent when called with no filters (the baked
          // snapshot call too), so it must default.
          handler: async (
            args: ListComponentsArgs = {}
          ): Promise<InspectorTreeNode[]> => {
            const roots = await currentRoots();
            const depth = args.maxDepth;
            return depth !== undefined && Number.isFinite(depth) && depth >= 1
              ? pruneTree(roots, Math.floor(depth))
              : roots;
          },
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
            recording.hmrIncompatibilities(),
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
            entries: recording.hmrHistory(),
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
              'Get reactive properties, attributes, and internal state for components, read from the page on each call. Pass id for one element (find it with list-components); that form returns null if the element has left the page. Or pass tagName (for example "todo-item", case-insensitive) for every element of that tag, in tree order, at most limit (default 20, ceiling 50): it returns {details, missing, truncated}, where missing lists matching element ids whose details could not be read and truncated means more elements matched than limit. A tag with no elements returns empty lists, so several elements of one tag are all returned, not just the first. Each element also carries extras when it has any: reactive controllers, @lit/task status and value, signals and plain instance fields.',
          },
          handler: async (
            args: ComponentDetailsArgs
          ): Promise<InspectorDetails | null | ComponentDetailsByTagResult> => {
            if (!('tagName' in args)) return currentDetails(args.id);
            const {ids, truncated} = findByTag(
              await currentRoots(),
              args.tagName,
              args.limit
            );
            // Concurrent: each live read waits up to the timeout on its own.
            const all = await Promise.all(ids.map(currentDetails));
            const details: InspectorDetails[] = [];
            const missing: number[] = [];
            all.forEach((d, i) =>
              d ? details.push(d) : missing.push(ids[i]!)
            );
            return {details, missing, truncated};
          },
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
            return recording.query(args, session.value().layers.recordingState);
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
          handler: async (): Promise<TimelineEvent[]> => recording.history(),
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
            return recording.summarize(
              args,
              session.value().layers.recordingState
            );
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
          // Resolving here rather than in the panel is the whole point of
          // the hop: `file` is relative to the Vite root, while the open
          // service resolves relative paths against the host's
          // `workspaceRoot` -- in a monorepo (or any setup where the served
          // app isn't the workspace) those are different directories, and
          // `launchEditor` silently does nothing for a path that doesn't
          // exist. Not agent-exposed: it spawns a GUI process.
          handler: async (args: OpenSourceArgs): Promise<OpenSourceResult> => {
            const service = ctx.services.get('@devframes/service-open');
            if (service === undefined) return {opened: false};
            // Confined like `/__lit-open-in-editor`: whatever can reach this
            // RPC could otherwise have the editor open any file on disk.
            // Imported here for the same reason as `buildSnapshot` below.
            const {createSourceLocator} = await import('../source-locator.js');
            let locator = sourceLocator?.();
            if (locator === undefined || locator.roots.length === 0) {
              locator = createSourceLocator([process.cwd()]);
            }
            const confined = locator.resolve(args.file);
            if ('failure' in confined) return {opened: false};
            const {path} = confined;
            const override = await my.settings.global.get('override');
            await service.openInEditor({
              path,
              line: args.line,
              editor: resolveLaunchEditor(configuredEditor?.(), override),
            });
            return {opened: true};
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
            // Imported here, not at module scope: this file has to keep
            // loading in contexts with no filesystem, and the build adapter
            // it pulls in reaches straight for `node:fs`.
            const {buildSnapshot} = await import('../snapshot.js');
            // `outDir` comes from the client and the build deletes it before
            // writing, so it has to land strictly beneath the working
            // directory -- never the directory itself, and never elsewhere
            // on disk (symlinks included). It usually does not exist yet.
            const {confineToRoots} = await import('../confine.js');
            const cwd = process.cwd();
            const confined = confineToRoots(
              [cwd],
              args.outDir ?? 'lit-devtools-snapshot',
              {mustExist: false, allowRoot: false}
            );
            if ('failure' in confined) {
              throw new Error(
                `[lit-devtools] export-snapshot: outDir must be inside ${cwd}`
              );
            }
            const outDir = confined.path;
            return buildSnapshot(
              recording.capture({
                capturedAt: new Date().toISOString(),
                version,
                customLayers: session.value().customLayers,
              }),
              {
                outDir,
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
  source: createNullSource(),
  version: '0.0.0',
});
