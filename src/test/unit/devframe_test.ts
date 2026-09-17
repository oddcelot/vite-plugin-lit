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

const boot = async () => {
  const source = new FakeSource();
  const def = createLitDevframe({
    source,
    version: '9.9.9',
    features: () => null,
  });
  instance = initDevframe(def, {
    base: '/__lit/',
    distDir: false,
    ws: false,
    sse: false,
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
