/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Mounts the Lit devframe ({@link createLitDevframe}) into the Vite DevTools
 * hub and bridges the page runtime's `import.meta.hot` transport to the
 * definition's `TimelineSource` port. Everything Vite-specific lives here:
 * the definition itself must keep running under `createDevServer()` with no
 * Vite installed.
 *
 * Vite DevTools 0.7+ is itself built on devframe, so its plugin context is a
 * devframe hub context: `ctx.install(definition)` serves the panel SPA from
 * the definition's `clientAssets`, registers its dock, and exposes its RPC
 * over the hub's authenticated WebSocket. That is all
 * `createPluginFromDevframe()` from `@vitejs/devtools-kit` does, so calling
 * `install` directly keeps DevTools an optional peer we never import at
 * runtime — the hook below is duck-typed, exactly as the panel's previous
 * dock registration was.
 *
 * @see plans/devframe-foundation.md
 */

import type {Plugin, ViteDevServer} from 'vite';
import type {DevframeDefinition} from 'devframe';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
} from '../../types/inspector.js';
import type {
  InspectorCommand,
  InspectorMessage,
} from '../../types/inspector.js';
import {HMR_INCOMPATIBLE_CHANNEL} from '../../types/hmr-incompatibility.js';
import type {HmrIncompatibilityEvent} from '../../types/hmr-incompatibility.js';
import {SETTINGS_OVERRIDE_CHANNEL} from '../../types/timeline.js';
import type {
  FeatureSettings,
  SettingsOverride,
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../../types/timeline.js';
import {createLitDevframe} from './definition.js';
import {LIT_DEVFRAME_ID} from './protocol.js';
import type {TimelineSink, TimelineSource} from './source.js';

export {createLitDevframe};

/**
 * The slice of the Vite DevTools hub context this plugin uses. Structurally a
 * subset of `ViteDevToolsNodeContext` from `@vitejs/devtools-kit/node`;
 * declared here so the package never imports that optional peer at runtime.
 * Install `@vitejs/devtools-kit` as a dev dependency to check it against the
 * real declarations.
 */
interface DevToolsHubContext {
  readonly viteServer?: ViteDevServer;
  /** Serve a devframe's SPA, register its dock, and run its `setup()`. */
  install: (
    devframe: DevframeDefinition,
    options?: {base?: string; dock?: Record<string, unknown>}
  ) => Promise<void>;
  docks?: {activate?: (dockId: string) => void};
  commands?: {register?: (command: Record<string, unknown>) => unknown};
}

declare module 'vite' {
  interface Plugin {
    /** Vite DevTools plugin hook, contributed by `@vitejs/devtools`. */
    devtools?: {
      capabilities?: {dev?: boolean; build?: boolean};
      setup: (ctx: DevToolsHubContext) => void | Promise<void>;
    };
  }
}

export interface CreateLitDevframePluginOptions {
  version: string;
  features?: () => FeatureSettings | null;
  /** Override the built panel SPA directory. Defaults to `dist/client`. */
  clientAssets?: string;
}

/**
 * `TimelineSource` over a Vite dev server's `hot` channel.
 *
 * `install()` runs the definition's `setup()` — and therefore
 * `source.attach()` — before it resolves, so this is attached before a dev
 * server is necessarily in hand. Calls made before {@link bind} are dropped
 * rather than buffered: nothing can emit a page-runtime event until a page
 * has connected to a bound server.
 */
export class HotTimelineSource implements TimelineSource {
  #hot: ViteDevServer['hot'] | undefined;
  #sink: TimelineSink | undefined;
  #hub: DevToolsHubContext | undefined;

  /**
   * Wire the source to a live dev server. Call once, from `devtools.setup()`.
   * `hub` is optional: without it the bridge still carries page traffic both
   * ways, it just cannot bring the dock to the front on an overlay pick.
   */
  bind(server: ViteDevServer, hub?: DevToolsHubContext): void {
    this.#hub = hub;
    const hot = server.hot;
    this.#hot = hot;

    hot.on('lit:timeline:push-event', (data: {events?: TimelineEvent[]}) => {
      this.#sink?.pushEvents(data.events ?? []);
    });

    hot.on('lit:timeline:custom-layer', (data: {layer?: TimelineLayer}) => {
      if (!data.layer?.id) return;
      this.#sink?.addLayer(data.layer);
    });

    hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
      // An overlay pick means the developer clicked an element in the page and
      // wants the Components tab. Bring the dock forward from the node side
      // rather than having the panel reach into the parent frame.
      if (data.type === 'pick') {
        this.#hub?.docks?.activate?.(LIT_DEVFRAME_ID);
      }
      this.#sink?.inspectorMessage(data);
    });

    hot.on(HMR_INCOMPATIBLE_CHANNEL, (event: HmrIncompatibilityEvent) => {
      this.#sink?.hmrIncompatible(event);
    });
  }

  /** Toggle the page's inspect overlay. Also used by the palette command. */
  toggleOverlay(): void {
    this.#hot?.send(INSPECT_OVERLAY_TOGGLE_CHANNEL);
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

  setRecording(recording: boolean): void {
    this.#hot?.send('lit:timeline:recording-changed', {recording});
  }

  setLayers(layers: TimelineLayersState): void {
    // Wire format matches what runtime/timeline/install.ts listens for: a flat
    // map of the boolean toggle fields, not `{layers}`.
    this.#hot?.send('lit:timeline:layers-changed', {
      litLifecycleEnabled: layers.litLifecycleEnabled,
      litRenderEnabled: layers.litRenderEnabled,
      mouseEventEnabled: layers.mouseEventEnabled,
      keyboardEventEnabled: layers.keyboardEventEnabled,
    });
  }

  setSettingsOverride(override: SettingsOverride): void {
    this.#hot?.send(SETTINGS_OVERRIDE_CHANNEL, override);
  }
}

/**
 * The Vite plugin that mounts the Lit devframe on the DevTools hub. A no-op
 * when DevTools is not active: without it nothing calls `devtools.setup()`,
 * so the definition is never installed and the panel simply isn't there.
 */
export function createLitDevframePlugin(
  options: CreateLitDevframePluginOptions
): Plugin {
  const source = new HotTimelineSource();
  const definition = createLitDevframe({
    source,
    version: options.version,
    features: options.features,
    clientAssets: options.clientAssets,
  });

  return {
    name: `devframe:${LIT_DEVFRAME_ID}`,
    devtools: {
      // The panel reflects a running page, so there is nothing to mount
      // during `vite build`. A static snapshot goes through
      // `devframe/adapters/build` instead.
      capabilities: {dev: true, build: false},
      async setup(ctx) {
        // Bind before installing: `install()` runs the definition's `setup()`,
        // which attaches to this source, and the dev server is already
        // available on the context by now.
        if (ctx.viteServer) source.bind(ctx.viteServer, ctx);
        await ctx.install(definition);

        // The overlay picker as a palette command with a managed shortcut.
        // Only meaningful when the source overlay is enabled, since that is
        // what draws the picker in the page.
        if (options.features?.()?.sourceOverlay.enabled) {
          ctx.commands?.register?.({
            id: 'lit:overlay:toggle',
            title: 'Pick Lit Element',
            description:
              'Click to inspect in the Components panel, hold Meta/Ctrl and click to open in your editor',
            icon: 'ph:crosshair-duotone',
            category: 'Lit',
            keybindings: [{key: 'Meta+Shift+E'}],
            handler: () => source.toggleOverlay(),
          });
        }
      },
    },
  };
}

/**
 * The page-runtime bridge on its own, for a host that drives its own mount
 * (or a test that wants to observe page traffic without a hub). Bind it to a
 * dev server, then either hand it to {@link createLitDevframe} or
 * {@link TimelineSource.attach} your own sink.
 */
export const createHotTimelineSource = (): HotTimelineSource =>
  new HotTimelineSource();
