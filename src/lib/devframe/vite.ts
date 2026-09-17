/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Mounts the Lit devframe ({@link createLitDevframe}) onto a Vite dev server
 * via `@vitejs/devtools-kit`, bridging the page runtime's existing
 * `import.meta.hot` transport (see timeline-plugin.ts) to the definition's
 * `TimelineSource` port. `@vitejs/devtools-kit` is an optional peer: it's
 * dynamically imported here so `litPlugin()` without `timeline` never loads
 * it.
 *
 * @see plans/devframe-foundation.md
 */

import type {Plugin, ViteDevServer} from 'vite';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
} from '../../types/inspector.js';
import type {
  InspectorCommand,
  InspectorMessage,
} from '../../types/inspector.js';
import type {
  FeatureSettings,
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import {createLitDevframe} from './definition.js';
import type {TimelineSink, TimelineSource} from './source.js';

export {createLitDevframe};

export interface CreateLitDevframePluginOptions {
  version: string;
  features?: () => FeatureSettings | null;
}

/**
 * `TimelineSource` over a Vite dev server's `hot` channel. Constructed before
 * the dev server exists (the definition's `setup()` may run before the Vite
 * bridge's `setup()` does), so every method ignores calls made before
 * {@link bind} runs — there's nothing to buffer for, since nothing can emit a
 * page-runtime event before a page has connected to a bound server anyway.
 */
class HotTimelineSource implements TimelineSource {
  #hot: ViteDevServer['hot'] | undefined;
  #sink: TimelineSink | undefined;

  /** Wire the source to the live dev server's HMR channel. Call once, from the Vite bridge's `setup()`. */
  bind(hot: ViteDevServer['hot']): void {
    this.#hot = hot;

    hot.on('lit:timeline:push-event', (data: {events?: TimelineEvent[]}) => {
      this.#sink?.pushEvents(data.events ?? []);
    });

    hot.on('lit:timeline:custom-layer', (data: {layer: TimelineLayer}) => {
      if (!data.layer?.id) return;
      this.#sink?.addLayer(data.layer);
    });

    hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
      this.#sink?.inspectorMessage(data);
    });
  }

  attach(sink: TimelineSink): () => void {
    this.#sink = sink;
    return () => {
      if (this.#sink === sink) this.#sink = undefined;
    };
  }

  sendInspector(cmd: InspectorCommand): void {
    this.#hot?.send(INSPECT_CMD_CHANNEL, cmd);
  }

  toggleOverlay(): void {
    this.#hot?.send(INSPECT_OVERLAY_TOGGLE_CHANNEL);
  }

  setRecording(recording: boolean): void {
    this.#hot?.send('lit:timeline:recording-changed', {recording});
  }

  setLayers(layers: TimelineLayersState): void {
    // Wire format matches the CONTROL_PATH handler in timeline-plugin.ts: a
    // flat partial map of the boolean toggle fields, not `{layers}`.
    this.#hot?.send('lit:timeline:layers-changed', {
      litLifecycleEnabled: layers.litLifecycleEnabled,
      litRenderEnabled: layers.litRenderEnabled,
      mouseEventEnabled: layers.mouseEventEnabled,
      keyboardEventEnabled: layers.keyboardEventEnabled,
    });
  }
}

/**
 * Builds the Vite plugin that mounts the Lit devframe on a dev server's
 * DevTools hub. `@vitejs/devtools-kit` is loaded lazily so plugins that never
 * enable `timeline` don't pay for it.
 */
export async function createLitDevframePlugin(
  options: CreateLitDevframePluginOptions
): Promise<Plugin> {
  let createPluginFromDevframe: (typeof import('@vitejs/devtools-kit/node'))['createPluginFromDevframe'];
  try {
    ({createPluginFromDevframe} = await import('@vitejs/devtools-kit/node'));
  } catch (cause) {
    throw new Error(
      '[lit-plugin] The Lit DevTools timeline requires "@vitejs/devtools-kit" to be installed. Run `pnpm add -D @vitejs/devtools-kit` and try again.',
      {cause}
    );
  }

  const source = new HotTimelineSource();
  const definition = createLitDevframe({
    source,
    version: options.version,
    features: options.features,
  });

  // timeline-plugin.ts still globally augments `vite`'s `Plugin.devtools`
  // with a pre-devframe duck-typed shim (`{setup: (ctx: TimelineCtx) => ...}`).
  // `PluginWithDevTools.devtools` (the real @vitejs/devtools-kit shape, keyed
  // on the much richer `ViteDevToolsNodeContext`) doesn't structurally satisfy
  // that stale ambient shim, so TS rejects the otherwise-valid
  // `PluginWithDevTools extends Plugin` relationship. Out of scope to remove
  // the shim here (phase 2 deletes it with the rest of the bespoke transport);
  // the cast is safe because the returned object is a real, complete `Plugin`.
  return createPluginFromDevframe(definition, {
    setup(ctx) {
      if (ctx.viteServer) {
        source.bind(ctx.viteServer.hot);
      }
    },
  }) as unknown as Plugin;
}
