/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterEach, describe, expect, test} from 'vite-plus/test';
import {initDevframe} from 'devframe/initiate';
import type {DevframeInstance} from 'devframe/initiate';
import {TIMELINE_LAYERS} from '../../types/timeline.js';
import {createLitDevframe} from '../../lib/devframe/definition.js';
import {RECENT_EVENTS_BUFFER_SIZE} from '../../lib/devframe/protocol.js';
import type {SessionState} from '../../lib/devframe/protocol.js';
import type {TimelineSink, TimelineSource} from '../../lib/devframe/source.js';
import type {InspectorCommand} from '../../types/inspector.js';
import type {
  SettingsOverride,
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

let instance: DevframeInstance | undefined;

const boot = async (options: {sourceRoot?: string} = {}) => {
  const source = new FakeSource();
  const def = createLitDevframe({
    source,
    version: '9.9.9',
    features: () => null,
    sourceRoot: () => options.sourceRoot,
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

describe('lit devframe definition', () => {
  test('registers the scoped rpc surface', async () => {
    const {ctx} = await boot();
    const names = ctx.rpc.list();
    for (const name of [
      'lit:get-meta',
      'lit:list-components',
      'lit:component-details',
      'lit:recent-events',
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
    const {ctx} = await boot({sourceRoot: '/workspace/app'});
    const opened: Array<{path: string; line?: number}> = [];
    ctx.services.provide('@devframes/service-open', {
      openInEditor: async (input) => {
        opened.push({path: input.path, line: input.line});
      },
      openInFinder: async () => {},
    });

    expect(
      await ctx.rpc.invokeLocal('lit:open-source', {
        file: 'src/app.ts',
        line: 12,
      })
    ).toEqual({opened: true});
    expect(opened).toEqual([{path: '/workspace/app/src/app.ts', line: 12}]);

    // A component outside the Vite root is injected with an absolute path,
    // which has to survive untouched.
    await ctx.rpc.invokeLocal('lit:open-source', {file: '/pkg/lib/x.ts'});
    expect(opened[1]?.path).toBe('/pkg/lib/x.ts');
  });

  test('open-source reports back when no open service is installed', async () => {
    // `opened: false` rather than a throw: it is the panel's cue to fall back
    // to `/__lit-open-in-editor` (see `panel/open-in-editor.ts`).
    const {ctx} = await boot({sourceRoot: '/workspace/app'});
    expect(
      await ctx.rpc.invokeLocal('lit:open-source', {file: 'src/app.ts'})
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

  test('recent-events filters by layer, element, and reports recording state', async () => {
    const {ctx, source} = await boot();
    let result = await ctx.rpc.invokeLocal('lit:recent-events', {});
    expect(result.recording).toBe(false);
    expect(result.events).toEqual([]);

    await ctx.rpc.invokeLocal('lit:set-recording', {recording: true});
    source.sink!.pushEvents([
      {layerId: 'lit-lifecycle', time: 0, data: {}, meta: {elementId: 1}},
      {layerId: 'mouse', time: 10, data: {}},
      {layerId: 'lit-lifecycle', time: 20, data: {}, meta: {elementId: 2}},
    ]);

    result = await ctx.rpc.invokeLocal('lit:recent-events', {});
    expect(result.recording).toBe(true);
    expect(result.events.length).toBe(3);
    expect(result.bufferSize).toBe(3);

    result = await ctx.rpc.invokeLocal('lit:recent-events', {
      layerId: 'lit-lifecycle',
    });
    expect(result.events.length).toBe(2);

    result = await ctx.rpc.invokeLocal('lit:recent-events', {elementId: 1});
    expect(result.events).toEqual([
      {layerId: 'lit-lifecycle', time: 0, data: {}, meta: {elementId: 1}},
    ]);
  });

  test('recent-events caps the ring buffer and marks truncation', async () => {
    const {ctx, source} = await boot();
    const events = Array.from({length: 520}, (_, i) => ({
      layerId: 'mouse',
      time: i,
      data: {},
    }));
    source.sink!.pushEvents(events);

    const result = await ctx.rpc.invokeLocal('lit:recent-events', {
      limit: 200,
    });
    expect(result.bufferSize).toBe(RECENT_EVENTS_BUFFER_SIZE);
    expect(result.events.length).toBe(200);
    expect(result.truncated).toBe(true);
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

  test('update-summary derives cycles and totals from the buffer', async () => {
    const {ctx, source} = await boot();
    const meta = {
      elementId: 1,
      tagName: 'hmr-counter',
      source: {file: '/src/counter.ts', line: 4},
    };
    source.sink!.pushEvents([
      {layerId: 'mouse', time: 0, title: 'click', subtitle: '(4, 8)', data: {}},
      {
        layerId: 'lit-lifecycle',
        time: 1,
        groupId: '1:1',
        title: 'performUpdate:start',
        data: {phase: 'performUpdate'},
        meta,
      },
      {
        layerId: 'lit-lifecycle',
        time: 1.5,
        groupId: '1:1',
        title: 'willUpdate:start',
        data: {phase: 'willUpdate', changed: ['count']},
        meta,
      },
      {
        layerId: 'lit-lifecycle',
        time: 2,
        groupId: '1:1',
        title: 'willUpdate:end',
        data: {phase: 'willUpdate'},
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
    expect(summary.components).toEqual([
      {
        tagName: 'hmr-counter',
        elementIds: [1],
        updates: 1,
        totalMs: 3,
        maxMs: 3,
        reasons: [{key: 'count', count: 1}],
        source: {file: '/src/counter.ts', line: 4},
      },
    ]);
    expect(summary.cycles.length).toBe(1);
    expect(summary.cycles[0]!.changed).toEqual(['count']);
    // The input layers earn their keep here: the click is what caused it.
    expect(summary.cycles[0]!.cause?.type).toBe('click');
    expect(summary.bufferSize).toBe(5);
    expect(summary.truncated).toBe(false);

    const other = await ctx.rpc.invokeLocal('lit:update-summary', {
      tagName: 'hmr-clock',
    });
    expect(other.components).toEqual([]);
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

  test('recent-events measures sinceMs against the whole buffer', async () => {
    const {ctx, source} = await boot();
    // Element 1 last rendered long ago; mouse events kept flowing since.
    source.sink!.pushEvents([
      {layerId: 'lit-lifecycle', time: 0, data: {}, meta: {elementId: 1}},
      {layerId: 'mouse', time: 9000, data: {}},
      {layerId: 'mouse', time: 10000, data: {}},
    ]);

    // A window measured off the newest *matching* event would wrongly report
    // element 1's stale render as recent; measured off the buffer it is out.
    const stale = await ctx.rpc.invokeLocal('lit:recent-events', {
      elementId: 1,
      sinceMs: 1000,
    });
    expect(stale.events).toEqual([]);

    const wide = await ctx.rpc.invokeLocal('lit:recent-events', {
      elementId: 1,
      sinceMs: 20000,
    });
    expect(wide.events.length).toBe(1);
  });
});
