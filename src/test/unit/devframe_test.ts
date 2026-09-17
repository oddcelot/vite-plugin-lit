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
