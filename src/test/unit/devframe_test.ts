import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {initDevframe} from 'devframe/initiate';
import type {DevframeInstance} from 'devframe/initiate';
import {TIMELINE_LAYERS} from '../../types/timeline.js';
import {createLitDevframe} from '../../lib/devframe/definition.js';
import {createSourceLocator} from '../../lib/source-locator.js';
import type {SessionState} from '../../lib/devframe/protocol.js';
import type {TimelineSink, TimelineSource} from '../../lib/devframe/source.js';
import type {
  InspectorCommand,
  InspectorDetails,
  InspectorTreeNode,
} from '../../types/inspector.js';
import type {
  FeatureSettings,
  SettingsOverride,
  TimelineEvent,
  TimelineLayersState,
} from '../../types/timeline.js';

/**
 * Boots the Lit devframe definition through devframe's own `initDevframe()`
 * (bridge mode: no SPA, no sockets) so `setup()` runs against a real
 * `DevframeNodeContext`. This pins the shape of the shared-state, streaming,
 * and RPC calls the definition makes; the transport itself is devframe's to
 * test.
 */

// A `TimelineSource` that records what the definition pushes to the page
// runtime and exposes the sink so tests can play the page runtime.
class FakeSource implements TimelineSource {
  sink: TimelineSink | undefined;
  readonly recording: boolean[] = [];
  readonly layers: TimelineLayersState[] = [];
  readonly inspector: InspectorCommand[] = [];
  readonly overrides: SettingsOverride[] = [];
  overlayToggles = 0;

  attach(sink: TimelineSink): () => void {
    this.sink = sink;
    return () => {
      this.sink = undefined;
    };
  }
  sendInspector(cmd: InspectorCommand): void {
    this.inspector.push(cmd);
  }
  toggleOverlay(): void {
    this.overlayToggles++;
  }
  setRecording(r: boolean): void {
    this.recording.push(r);
  }
  setLayers(l: TimelineLayersState): void {
    this.layers.push(l);
  }
  setSettingsOverride(override: SettingsOverride): void {
    this.overrides.push(override);
  }
}

// `open-source` only opens files that exist beneath an allowed root, so the
// tests that exercise it point at real directories of this repo: `src/lib`
// plays the Vite root, `src/test/fixtures` a sibling package vite serves
// through `server.fs.allow`, and the repo's `package.json` sits outside both.
// (No `node:` imports here: the pre-commit hook's single-file check can't
// type them under `src/test/`.)
const repoPath = (relative: string) =>
  decodeURIComponent(new URL(relative, import.meta.url).pathname);
const appRoot = repoPath('../../lib');
const pkgRoot = repoPath('../fixtures');
const outsideFile = repoPath('../../../package.json');

let instance: DevframeInstance | undefined;

const boot = async (
  options: {
    roots?: string[];
    configuredEditor?: string;
    inspectorTimeoutMs?: number;
  } = {}
) => {
  const source = new FakeSource();
  const def = createLitDevframe({
    source,
    version: '9.9.9',
    features: () => null,
    sourceLocator: () =>
      options.roots === undefined
        ? undefined
        : createSourceLocator(options.roots),
    configuredEditor: () => options.configuredEditor,
    inspectorTimeoutMs: options.inspectorTimeoutMs,
  });
  instance = initDevframe(def, {
    base: '/__lit/',
    distDir: false,
    ws: false,
    sse: false,
    // The settings store is file-backed, and the standalone host layout puts
    // `global` under the developer's home directory. Redirect every scope
    // into the repo's own ignored scratch dir so a test run never writes
    // there -- relative, so it resolves against the runner's cwd.
    getStorageDir: () => './node_modules/.tmp-lit-devframe-test',
  });
  const ctx = await instance.context;
  await instance.ready;
  return {source, ctx};
};

afterEach(async () => {
  await instance?.close();
  instance = undefined;
});

const treeNode: InspectorTreeNode = {id: 3, tagName: 'x-a', children: []};
const detailsFor = (id: number): InspectorDetails => ({
  id,
  tagName: 'x-a',
  attributes: [],
  properties: [],
  flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
});

const pageEvent = (time: number): TimelineEvent => ({
  layerId: 'lit-render',
  time,
  data: {},
});

describe('lit devframe definition', () => {
  test('list-components asks the page and returns its answer', async () => {
    const {source, ctx} = await boot({inspectorTimeoutMs: 1000});
    const pending = ctx.rpc.invokeLocal('lit:list-components');
    await vi.waitFor(() =>
      expect(source.inspector.at(-1)).toEqual({type: 'tree'})
    );
    source.sink!.inspectorMessage({type: 'tree', roots: [treeNode]});
    expect(await pending).toEqual([treeNode]);
  });

  test('component-details asks the page by id and reports a gone element', async () => {
    const {source, ctx} = await boot({inspectorTimeoutMs: 1000});
    const found = ctx.rpc.invokeLocal('lit:component-details', {id: 3});
    await vi.waitFor(() =>
      expect(source.inspector.at(-1)).toEqual({type: 'details', id: 3})
    );
    source.sink!.inspectorMessage({type: 'details', details: detailsFor(3)});
    expect(await found).toEqual(detailsFor(3));

    // The cache now holds id 3, so a null here proves the page's `gone` wins
    // over the stale entry.
    const gone = ctx.rpc.invokeLocal('lit:component-details', {id: 3});
    await vi.waitFor(() => expect(source.inspector).toHaveLength(2));
    source.sink!.inspectorMessage({type: 'gone', id: 3});
    expect(await gone).toBeNull();
  });

  test('list-components falls back to the cache when nothing answers', async () => {
    const {source, ctx} = await boot({inspectorTimeoutMs: 20});
    source.sink!.inspectorMessage({type: 'tree', roots: [treeNode]});
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual([
      treeNode,
    ]);
  });

  test('a ready from the page already followed keeps its buffer', async () => {
    const {source, ctx} = await boot();
    source.sink!.runtimeReady('a');
    source.sink!.pushEvents([pageEvent(1), pageEvent(2)], 'a');
    source.sink!.runtimeReady('a');
    expect(await ctx.rpc.invokeLocal('lit:timeline-history')).toHaveLength(2);
  });

  test('a ready from another page clears the buffer and says so', async () => {
    const {source, ctx} = await boot();
    const spy = vi.spyOn(ctx.rpc, 'broadcast');
    // The event stream broadcasts too; only the notice matters here.
    const notices = () =>
      spy.mock.calls.filter(([call]) => call.method === 'lit:page-changed');
    source.sink!.runtimeReady('a');
    source.sink!.pushEvents([pageEvent(1), pageEvent(2)], 'a');
    expect(notices()).toHaveLength(0);

    source.sink!.runtimeReady('b');
    expect(await ctx.rpc.invokeLocal('lit:timeline-history')).toEqual([]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]![0]).toMatchObject({
      args: [{previousPageId: 'a', pageId: 'b'}],
    });
    expect((await ctx.rpc.invokeLocal('lit:get-meta')).activePageId).toBe('b');
  });

  test('drops events and inspector messages from a page that is not followed', async () => {
    const {source, ctx} = await boot();
    source.sink!.runtimeReady('a');
    source.sink!.runtimeReady('b');
    source.sink!.pushEvents([pageEvent(1)], 'a');
    source.sink!.inspectorMessage({type: 'tree', roots: [treeNode]}, 'a');
    expect(await ctx.rpc.invokeLocal('lit:timeline-history')).toEqual([]);
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual([]);

    source.sink!.pushEvents([pageEvent(2)], 'b');
    source.sink!.inspectorMessage({type: 'tree', roots: [treeNode]}, 'b');
    expect(await ctx.rpc.invokeLocal('lit:timeline-history')).toHaveLength(1);
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual([
      treeNode,
    ]);
  });

  test('a stale page cannot answer an agent query', async () => {
    const {source, ctx} = await boot({inspectorTimeoutMs: 1000});
    source.sink!.runtimeReady('a');
    source.sink!.runtimeReady('b');
    const pending = ctx.rpc.invokeLocal('lit:list-components');
    await vi.waitFor(() =>
      expect(source.inspector.at(-1)).toEqual({type: 'tree'})
    );
    source.sink!.inspectorMessage({type: 'tree', roots: [treeNode]}, 'a');
    const other: InspectorTreeNode = {id: 9, tagName: 'x-b', children: []};
    source.sink!.inspectorMessage({type: 'tree', roots: [other]}, 'b');
    expect(await pending).toEqual([other]);
  });

  test('runtimes without a page id are never filtered', async () => {
    const {source, ctx} = await boot();
    source.sink!.runtimeReady(undefined);
    source.sink!.pushEvents([pageEvent(1)]);
    source.sink!.runtimeReady(undefined);
    source.sink!.pushEvents([pageEvent(2)]);
    expect(await ctx.rpc.invokeLocal('lit:timeline-history')).toHaveLength(1);
    source.sink!.inspectorMessage({type: 'tree', roots: [treeNode]});
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual([
      treeNode,
    ]);
  });

  test('registers the scoped rpc surface', async () => {
    const {ctx} = await boot();
    const names = ctx.rpc.list();
    for (const name of [
      'lit:get-meta',
      'lit:list-components',
      'lit:component-details',
      'lit:recent-events',
      'lit:timeline-history',
      'lit:update-summary',
      'lit:inspect',
      'lit:set-recording',
      'lit:toggle-layer',
    ]) {
      expect(names).toContain(name);
    }
  });

  test('exposes exactly one mutating tool to agents', async () => {
    // `set-recording` is the deliberate exception to the read-only agent
    // surface (see plans/devframe-foundation.md). Asserting the whole set,
    // not just its presence, so quietly agent-exposing the picker or a layer
    // toggle fails here instead of shipping.
    const {ctx} = await boot();
    const tools = ctx.agent.list().tools;
    const exposed = tools
      .filter((t) => t.rpcName?.startsWith('lit:'))
      .map((t) => t.rpcName);
    expect(exposed).toContain('lit:set-recording');
    // A query, so read-safe by inference — it must not join the mutating set.
    expect(exposed).toContain('lit:update-summary');
    expect(exposed).not.toContain('lit:inspect');
    expect(exposed).not.toContain('lit:toggle-layer');

    const recordingTool = tools.find((t) => t.rpcName === 'lit:set-recording');
    expect(recordingTool?.description).toContain('shared toggle');
  });

  test('does not install the open-in-editor service itself', async () => {
    // The panel prefers `@devframes/service-open` for its source links, but
    // consumes it rather than installing it: on a Vite hub
    // `@devframes/plugin-messages` already installed it before the services
    // barrier, so declaring it here only earns a DF0066 warning on every dev
    // server start. A host without it is fine — the panel falls back to
    // `/__lit-open-in-editor`. Asserting the absence so a future declaration
    // is a deliberate choice and not a silently reintroduced startup warning.
    const {ctx} = await boot();
    expect(ctx.services.has('@devframes/service-open')).toBe(false);
  });

  test('open-source resolves panel paths against the vite root', async () => {
    // The panel's `file` comes from the transform, so it is relative to the
    // Vite root -- while the open service resolves relative paths against the
    // host's `workspaceRoot`. Those differ whenever the served app isn't the
    // workspace (a monorepo playground, say), and `launchEditor` silently
    // does nothing for a path that doesn't exist, so the mismatch shows up as
    // a source link that just doesn't respond.
    const {ctx} = await boot({roots: [appRoot, pkgRoot]});
    const opened: Array<{path: string; line?: number}> = [];
    ctx.services.provide('@devframes/service-open', {
      openInEditor: async (input) => {
        opened.push({path: input.path, line: input.line});
      },
      openInFinder: async () => {},
    });

    expect(
      await ctx.rpc.invokeLocal('lit:open-source', {
        file: 'confine.ts',
        line: 12,
      })
    ).toEqual({opened: true});
    expect(opened).toEqual([{path: `${appRoot}/confine.ts`, line: 12}]);

    // A component outside the Vite root is injected with an absolute path,
    // which has to survive untouched when an allowed root covers it.
    const sibling = `${pkgRoot}/client-types/consumer.ts`;
    await ctx.rpc.invokeLocal('lit:open-source', {file: sibling});
    expect(opened[1]?.path).toBe(sibling);
  });

  test('open-source refuses files outside the allowed roots', async () => {
    // Whatever reaches this RPC -- the panel, or any client of a standalone
    // server started with `--no-auth` -- could otherwise have the editor open
    // any file on disk. Same boundary as `/__lit-open-in-editor`; the cases
    // live in `source-locator_test.ts`, this checks the RPC goes through it.
    const {ctx} = await boot({roots: [appRoot, pkgRoot]});
    const opened: string[] = [];
    ctx.services.provide('@devframes/service-open', {
      openInEditor: async (input) => {
        opened.push(input.path);
      },
      openInFinder: async () => {},
    });

    for (const file of [outsideFile, 'missing.ts']) {
      expect(await ctx.rpc.invokeLocal('lit:open-source', {file})).toEqual({
        opened: false,
      });
    }
    expect(opened).toEqual([]);
  });

  test('open-source passes the chosen editor to the open service', async () => {
    // The Settings tab's editor pick used to steer only the overlay's URL
    // scheme; the server-side open handed `launch-editor` no editor and let
    // it auto-detect. Config picks the editor, the panel's stored override
    // beats it, and a developer who never chose keeps auto-detection.
    const {ctx} = await boot({
      roots: [appRoot],
      configuredEditor: 'cursor',
    });
    const editors: Array<string | undefined> = [];
    ctx.services.provide('@devframes/service-open', {
      openInEditor: async (input) => {
        editors.push(input.editor);
      },
      openInFinder: async () => {},
    });
    const open = () =>
      ctx.rpc.invokeLocal('lit:open-source', {file: 'confine.ts', line: 1});
    const settings = ctx.scope('lit').settings.global;

    await open();
    await settings.set('override', {sourceOverlayEditor: 'vscode'});
    await open();
    // No launch-editor command for it: auto-detect, not a stale `vscode`.
    await settings.set('override', {sourceOverlayEditor: 'windsurf'});
    await open();
    await settings.delete('override');
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(editors).toEqual(['cursor', 'code', undefined]);
  });

  test('open-source auto-detects when no editor was chosen', async () => {
    const {ctx} = await boot({roots: [appRoot]});
    let editor: string | undefined = 'unset';
    ctx.services.provide('@devframes/service-open', {
      openInEditor: async (input) => {
        editor = input.editor;
      },
      openInFinder: async () => {},
    });
    await ctx.rpc.invokeLocal('lit:open-source', {file: 'confine.ts'});
    expect(editor).toBeUndefined();
  });

  test('open-source reports back when no open service is installed', async () => {
    // `opened: false` rather than a throw: it is the panel's cue to fall back
    // to `/__lit-open-in-editor` (see `panel/open-in-editor.ts`).
    const {ctx} = await boot({roots: [appRoot]});
    expect(
      await ctx.rpc.invokeLocal('lit:open-source', {file: 'confine.ts'})
    ).toEqual({opened: false});
  });

  test('settings round-trip through the global store', async () => {
    // Pins `DevframeSettingsRegistry.lit` (protocol.ts) against a real
    // settings store rather than against the typings alone: the panel writes
    // both of these keys, and a rename here would otherwise only surface as
    // preferences silently not persisting.
    const {ctx} = await boot();
    const settings = ctx.scope('lit').settings.global;
    // Unique per run, so a settings file left over from an earlier run
    // cannot make this pass.
    const editor = `zed-${Date.now()}`;

    expect(await settings.get('override')).toBeUndefined();

    await settings.set('appearance', 'dark');
    await settings.set('override', {sourceOverlayEditor: editor});
    expect(await settings.get('appearance')).toBe('dark');
    expect(await settings.get('override')).toEqual({
      sourceOverlayEditor: editor,
    });

    // `_reset()` in the panel deletes rather than storing an empty override;
    // a `delete` that left the key behind would resurrect a cleared
    // override on the next panel connection.
    await settings.delete('override');
    expect(await settings.get('override')).toBeUndefined();
    await settings.delete('appearance');
  });

  test('settings survive a host restart', async () => {
    // The point of the whole feature: a preference set through the panel has
    // to outlive the dev server, which is what `localStorage` alone never
    // did. Two separate hosts over the same storage dir is the closest a
    // unit test gets to a restart.
    //
    // The sleep is load-bearing, not flake padding: `createStorage` debounces
    // its writes by 100ms and nothing flushes on close, so a value written
    // and immediately abandoned never reaches disk.
    const editor = `zed-${Date.now()}`;
    const first = await boot();
    await first.ctx.scope('lit').settings.global.set('override', {
      sourceOverlayEditor: editor,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await instance!.close();
    instance = undefined;

    const second = await boot();
    const settings = second.ctx.scope('lit').settings.global;
    expect(await settings.get('override')).toEqual({
      sourceOverlayEditor: editor,
    });
    await settings.delete('override');
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  test('get-meta reports the version and custom layers', async () => {
    const {ctx, source} = await boot();
    source.sink!.addLayer({id: 'custom', label: 'Custom', color: 0xffffff});
    source.sink!.addLayer({id: 'custom', label: 'Dup', color: 0x000000});
    const meta = await ctx.rpc.invokeLocal('lit:get-meta');
    expect(meta.version).toBe('9.9.9');
    expect(meta.layers).toEqual([
      ...TIMELINE_LAYERS,
      {id: 'custom', label: 'Custom', color: 0xffffff},
    ]);
    expect(meta.stream).toEqual({channel: 'lit:timeline', id: 'live'});
    expect(meta.features).toBeNull();
    // No overlay, no picker.
    expect(meta.picker).toBe(false);
  });

  test('get-meta reports a picker when the source overlay is on', async () => {
    instance = initDevframe(
      createLitDevframe({
        source: new FakeSource(),
        version: '9.9.9',
        features: () =>
          ({sourceOverlay: {enabled: true}}) as unknown as FeatureSettings,
      }),
      {
        base: '/__lit/',
        distDir: false,
        ws: false,
        sse: false,
        getStorageDir: () => './node_modules/.tmp-lit-devframe-test',
      }
    );
    const ctx = await instance.context;
    await instance.ready;
    expect((await ctx.rpc.invokeLocal('lit:get-meta')).picker).toBe(true);
  });

  test('actions mutate the session and reach the page runtime', async () => {
    const {ctx, source} = await boot();
    await ctx.rpc.invokeLocal('lit:set-recording', {recording: true});
    await ctx.rpc.invokeLocal('lit:toggle-layer', {
      layerId: 'mouse',
      enabled: false,
    });
    // Shared-state `updated` is emitted asynchronously (and may coalesce
    // back-to-back mutations), so assert on the settled result, not counts.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const session = await ctx.rpc.sharedState.get<SessionState>('lit:session');
    expect(session.value().layers.recordingState).toBe(true);
    expect(session.value().layers.mouseEventEnabled).toBe(false);

    expect(source.recording.at(-1)).toBe(true);
    expect(source.layers.at(-1)?.mouseEventEnabled).toBe(false);
    expect(source.layers.at(-1)?.litRenderEnabled).toBe(true);
  });

  test('inspect forwards commands and pick toggles the overlay', async () => {
    const {ctx, source} = await boot();
    await ctx.rpc.invokeLocal('lit:inspect', {type: 'tree'});
    await ctx.rpc.invokeLocal('lit:inspect', {type: 'pick'});
    expect(source.inspector).toEqual([{type: 'tree'}]);
    expect(source.overlayToggles).toBe(1);
  });

  test('caches the latest inspector tree and details', async () => {
    const {ctx, source} = await boot();
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual([]);
    const root = {id: 1, tagName: 'my-app', children: []};
    source.sink!.inspectorMessage({type: 'tree', roots: [root]});
    const details = {
      id: 1,
      tagName: 'my-app',
      attributes: [],
      properties: [],
      flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
    };
    source.sink!.inspectorMessage({type: 'details', details});
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual([root]);
    expect(await ctx.rpc.invokeLocal('lit:component-details', {id: 1})).toEqual(
      details
    );
    expect(
      await ctx.rpc.invokeLocal('lit:component-details', {id: 2})
    ).toBeNull();
  });

  test('recent-events passes its filters through to the session', async () => {
    // The filter semantics are `session_test.ts`'s; this checks the RPC
    // forwards its arguments and the live recording flag.
    const {ctx, source} = await boot();
    await ctx.rpc.invokeLocal('lit:set-recording', {recording: true});
    source.sink!.pushEvents([
      {layerId: 'lit-lifecycle', time: 0, data: {}, meta: {elementId: 1}},
      {layerId: 'mouse', time: 10, data: {}},
    ]);
    const result = await ctx.rpc.invokeLocal('lit:recent-events', {
      layerId: 'mouse',
    });
    expect(result.recording).toBe(true);
    expect(result.bufferSize).toBe(2);
    expect(result.events.map((e) => e.layerId)).toEqual(['mouse']);
  });

  test('timeline-history answers the whole buffer, uncapped by the agent limit', async () => {
    const {ctx, source} = await boot();
    source.sink!.pushEvents(
      Array.from({length: 300}, (_, i) => ({
        layerId: 'mouse',
        time: i,
        data: {},
      }))
    );
    const history = await ctx.rpc.invokeLocal('lit:timeline-history');
    expect(history.length).toBe(300);
    expect(history[299]!.time).toBe(299);

    // Same reset as recent-events: a new page is a new clock.
    source.sink!.runtimeReady();
    expect(await ctx.rpc.invokeLocal('lit:timeline-history')).toEqual([]);
  });

  test('a replayed session answers recent-events with its whole buffer', async () => {
    // More than the live default of 50, which is what a frozen panel must
    // not be cut to.
    const events = Array.from({length: 60}, (_, i) => ({
      id: `old-${i}`,
      layerId: 'mouse',
      time: i,
      data: {},
    }));
    instance = initDevframe(
      createLitDevframe({
        source: new FakeSource(),
        version: '9.9.9',
        features: () => null,
        replay: {
          capturedAt: new Date().toISOString(),
          version: '9.9.9',
          customLayers: [],
          roots: [],
          details: [],
          events,
          hmrIncompatibilities: [],
        },
      }),
      {
        base: '/__lit/',
        distDir: false,
        ws: false,
        sse: false,
        getStorageDir: () => './node_modules/.tmp-lit-devframe-test',
      }
    );
    const ctx = await instance.context;
    await instance.ready;
    const result = await ctx.rpc.invokeLocal('lit:recent-events');
    // The frozen panel reads this no-argument call; the live default of 50
    // would drop everything a link could point at.
    expect(result.events.length).toBe(60);
    expect(result.events[0]!.id).toBe('old-0');
  });

  test('replays recording state to a runtime that just connected', async () => {
    const {ctx, source} = await boot();
    await ctx.rpc.invokeLocal('lit:set-recording', {recording: true});
    // Ignore the pushes caused by the toggle itself; we care about what a
    // page gets when it connects afterwards.
    source.recording.length = 0;
    source.layers.length = 0;

    // A page loads or reloads while recording is already on. Without this
    // replay it boots with `recordingState: false` and captures nothing,
    // while every surface still reports `recording: true`.
    source.sink!.runtimeReady();

    expect(source.recording).toEqual([true]);
    expect(source.layers[0]?.recordingState).toBe(true);
  });

  test('replays the stored settings override to a runtime that just connected', async () => {
    const {ctx, source} = await boot();
    const settings = ctx.scope('lit').settings.global;
    await settings.set('override', {flashUpdates: true});
    try {
      // Cross-origin pages (standalone, StackBlitz) have no localStorage copy
      // of the panel's override, so the node replays it on every boot.
      source.sink!.runtimeReady();
      await vi.waitFor(() =>
        expect(source.overrides).toEqual([{flashUpdates: true}])
      );
    } finally {
      await settings.delete('override');
    }
  });

  test('sends no settings override when none is stored', async () => {
    const {ctx, source} = await boot();
    await ctx.scope('lit').settings.global.delete('override');
    source.sink!.runtimeReady();
    // The replay is async; let the store read settle before asserting.
    await ctx.scope('lit').settings.global.get('override');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.overrides).toEqual([]);
  });

  test('drops buffered events from the previous page on reconnect', async () => {
    const {ctx, source} = await boot();
    source.sink!.pushEvents([{layerId: 'mouse', time: 4000, data: {}}]);
    expect((await ctx.rpc.invokeLocal('lit:recent-events')).bufferSize).toBe(1);

    // The runtime re-zeroes its clock per page, so keeping the old page's
    // events would put two time origins in one buffer and make `sinceMs`
    // meaningless.
    source.sink!.runtimeReady();

    const after = await ctx.rpc.invokeLocal('lit:recent-events');
    expect(after.bufferSize).toBe(0);
    expect(after.events).toEqual([]);
  });

  test('drops buffered events when a new recording starts', async () => {
    const {ctx, source} = await boot();
    await ctx.rpc.invokeLocal('lit:set-recording', {recording: true});
    // Shared-state `updated` is emitted asynchronously, and the rising-edge
    // clear rides on it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    source.sink!.pushEvents([{layerId: 'mouse', time: 4000, data: {}}]);

    // Stopping keeps the recording readable — that is the point of stopping.
    await ctx.rpc.invokeLocal('lit:set-recording', {recording: false});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await ctx.rpc.invokeLocal('lit:recent-events')).bufferSize).toBe(1);

    // Starting again re-zeroes the page's timeline clock, so the previous
    // recording's times would sit *above* everything captured afterwards:
    // `sinceMs` reads them as the future and a start/end pair spanning the
    // seam has a negative duration.
    await ctx.rpc.invokeLocal('lit:set-recording', {recording: true});
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await ctx.rpc.invokeLocal('lit:recent-events');
    expect(after.bufferSize).toBe(0);
    expect(after.events).toEqual([]);
  });

  test('update-summary summarizes the buffer and forwards tagName', async () => {
    // Derivation is covered by `timeline-derive_test.ts` and the windowing by
    // `session_test.ts`; this checks the RPC reaches them.
    const {ctx, source} = await boot();
    const meta = {elementId: 1, tagName: 'hmr-counter'};
    source.sink!.pushEvents([
      {
        layerId: 'lit-lifecycle',
        time: 1,
        groupId: '1:1',
        title: 'performUpdate:start',
        data: {phase: 'performUpdate', changed: ['count']},
        meta,
      },
      {
        layerId: 'lit-lifecycle',
        time: 4,
        groupId: '1:1',
        title: 'performUpdate:end',
        data: {phase: 'performUpdate'},
        meta,
      },
    ]);

    const summary = await ctx.rpc.invokeLocal('lit:update-summary');
    expect(summary.components.map((c) => c.tagName)).toEqual(['hmr-counter']);
    expect(summary.cycles[0]!.changed).toEqual(['count']);
    expect(summary.bufferSize).toBe(2);

    const other = await ctx.rpc.invokeLocal('lit:update-summary', {
      tagName: 'hmr-clock',
    });
    expect(other.cycles).toEqual([]);
  });

  test('recent-events works with no arguments at all', async () => {
    // An agent calling the tool with no filters sends no argument object at
    // all, not an empty one — `invokeLocal(name, {})` would not catch this.
    const {ctx} = await boot();
    const result = await ctx.rpc.invokeLocal('lit:recent-events');
    expect(result.recording).toBe(false);
    expect(result.events).toEqual([]);
  });
});
