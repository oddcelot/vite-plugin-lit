/**
 * The `TimelineSource` port: the abstraction over "where page-runtime
 * traffic comes from". The framework-neutral definition
 * ({@link ../definition.ts}) only ever talks to this interface, so it can run
 * under `createDevServer()` with no Vite installed. `vite.ts` supplies the
 * real implementation (an `import.meta.hot` bridge); `createDevServer()` /
 * `createBuild()` / an MCP server use {@link createNullSource} instead, since
 * no page is attached.
 */

import type {
  InspectorCommand,
  InspectorMessage,
} from '../../types/inspector.js';
import type {
  SettingsOverride,
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';

/** The definition's sink for events arriving from the page runtime. */
export interface TimelineSink {
  pushEvents(events: TimelineEvent[], pageId?: string): void;
  addLayer(layer: TimelineLayer): void;
  inspectorMessage(msg: InspectorMessage, pageId?: string): void;
  hmrIncompatible(event: HmrIncompatibilityEvent): void;
  /**
   * A page runtime just connected (first load, reload, or HMR reconnect). It
   * starts from the compiled-in defaults, so whatever recording/layer state
   * this session already holds has to be replayed to it — otherwise a page
   * loaded while recording is on silently captures nothing. `pageId`
   * identifies the document; runtimes older than the field omit it.
   * `tabId` survives a reload of the same tab, so a reload can be told from
   * another tab opening.
   */
  runtimeReady(pageId?: string, tabId?: string): void;
}

/** Where the definition sends/receives page-runtime traffic. */
export interface TimelineSource {
  /** Start forwarding page-runtime traffic to `sink`. Returns a detach function. */
  attach(sink: TimelineSink): () => void;
  sendInspector(cmd: InspectorCommand): void;
  toggleOverlay(): void;
  setRecording(r: boolean): void;
  setLayers(l: TimelineLayersState): void;
  /** Apply a live feature-settings override to the running page. */
  setSettingsOverride(override: SettingsOverride): void;
}

/**
 * The wire form of {@link TimelineLayersState}: the flat map of boolean toggle
 * fields the page runtime's `lit:timeline:layers-changed` listener expects,
 * not `{layers}`. Shared by every source so they cannot drift apart.
 */
export const layersWireFormat = (layers: TimelineLayersState) => ({
  litLifecycleEnabled: layers.litLifecycleEnabled,
  litRenderEnabled: layers.litRenderEnabled,
  litRenderVerboseEnabled: layers.litRenderVerboseEnabled,
  litChangedValuesEnabled: layers.litChangedValuesEnabled,
  mouseEventEnabled: layers.mouseEventEnabled,
  keyboardEventEnabled: layers.keyboardEventEnabled,
});

/**
 * No-op source used wherever no page is attached (`createDevServer()`,
 * `createBuild()`, an MCP server). `attach()` never calls the sink; every
 * other method is a no-op.
 */
export function createNullSource(): TimelineSource {
  return {
    attach() {
      return () => {};
    },
    sendInspector() {},
    toggleOverlay() {},
    setRecording() {},
    setLayers() {},
    setSettingsOverride() {},
  };
}
