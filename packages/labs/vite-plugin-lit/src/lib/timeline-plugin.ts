/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
import type {TimelineEvent} from '../types/timeline.js';

// ---------------------------------------------------------------------------
// Minimal type shims for the @vitejs/devtools-kit surface we use.
// These are structurally compatible with the real types; we duck-type against
// the context object passed by @vitejs/devtools' devtools.setup hook.
// Install @vitejs/devtools-kit as a peer dep to get the real declarations.
// ---------------------------------------------------------------------------

interface DockEntry {
  id: string;
  type: 'iframe';
  title: string;
  icon: string;
  url: string;
  category?: string;
}

interface RpcFn {
  name: string;
  type?: string;
  handler?: (...args: unknown[]) => unknown;
}

interface TimelineCtx {
  docks: {register: (entry: DockEntry) => unknown};
  rpc: {
    register: (fn: RpcFn) => void;
    functions?: Record<string, (...args: unknown[]) => unknown>;
  };
  views: {hostStatic: (baseUrl: string, distDir: string) => void};
  viteServer?: {
    middlewares: {
      use: (
        path: string,
        handler: (
          req: {url?: string},
          res: {
            statusCode: number;
            setHeader: (k: string, v: string) => void;
            end: (body: string) => void;
          },
          next: () => void
        ) => void
      ) => void;
    };
  };
  viteConfig?: {root: string};
}

// Augment Vite's Plugin interface to accept the devtools hook without
// requiring @vitejs/devtools-kit as a direct dep of this package.
declare module 'vite' {
  interface Plugin {
    devtools?: {
      capabilities?: unknown;
      setup: (ctx: TimelineCtx) => void | Promise<void>;
    };
  }
}

// ---------------------------------------------------------------------------
// Timeline event store — accumulates events from the browser runtime and
// pushes them to the panel via Vite's HMR channel (Phase 0/1 transport).
// Phase 2 migrates this to devframe's typed RPC + shared state.
// ---------------------------------------------------------------------------

const PANEL_PATH = '/__lit-timeline';

const resolvePanel = (): string => {
  const url = new URL('../panel/index.html', import.meta.url);
  if (existsSync(url)) {
    return fileURLToPath(new URL('../panel', import.meta.url));
  }
  throw new Error('[lit-plugin:timeline] panel directory not found');
};

/**
 * Vite plugin that registers the Lit Timeline dock entry in Vite DevTools.
 *
 * Activated by `devtools.setup(ctx)` which is called by `@vitejs/devtools`
 * when the dev server starts. If `@vitejs/devtools` is not installed the hook
 * is never invoked and the timeline feature silently no-ops.
 *
 * Phase 0: panel served from `src/panel/`, dock entry registered.
 * Phase 1: browser capture runtime injected (via transformIndexHtml).
 * Phase 2: devframe RPC wired for event forwarding.
 */
export const litTimelinePlugin = (): Plugin => {
  // Snapshot of pending events waiting to be forwarded to the panel.
  // Populated by the `lit:timeline:push-event` RPC handler (Phase 2) or
  // the Vite HMR channel handler (Phase 0/1 interim).
  const pendingEvents: TimelineEvent[] = [];

  return {
    name: 'lit-timeline',
    apply: 'serve',

    configureServer(server) {
      // Phase 0/1 interim: accept events from the browser runtime over the
      // Vite HMR WebSocket channel.  Phase 2 replaces this with devframe RPC.
      server.hot.on(
        'lit:timeline:push-event',
        (data: {event: TimelineEvent}) => {
          pendingEvents.push(data.event);
          // Flush to all connected clients so the panel iframe receives it.
          server.hot.send('lit:timeline:events', {
            events: pendingEvents.slice(-1),
          });
        }
      );

      // Acknowledge recording-state toggle from the panel.
      server.hot.on(
        'lit:timeline:set-recording',
        (data: {recording: boolean}) => {
          server.hot.send('lit:timeline:recording-changed', {
            recording: data.recording,
          });
        }
      );
    },

    devtools: {
      setup(ctx: TimelineCtx) {
        // Serve the panel static files at /__lit-timeline/.
        // ctx.views.hostStatic registers Vite middleware in dev mode.
        let panelDir: string;
        try {
          panelDir = resolvePanel();
        } catch (e) {
          console.warn(String(e));
          return;
        }

        ctx.views.hostStatic(PANEL_PATH + '/', panelDir);

        // Register the Lit Timeline dock entry as an iframe panel.
        ctx.docks.register({
          id: 'lit-timeline',
          type: 'iframe',
          title: 'Lit Timeline',
          // i-carbon-chart-line-data or any UnoCSS/iconify string.
          icon: 'i-carbon-chart-line-data',
          url: PANEL_PATH + '/',
          category: 'framework',
        });

        // Phase 0 RPC: a simple ping to confirm the RPC channel is live.
        ctx.rpc.register({
          name: 'lit:timeline:ping',
          type: 'event',
          handler: () => {
            console.log('[lit-plugin:timeline] ping received via RPC');
          },
        });

        // Phase 2 placeholder: pushTimelineEvent RPC.
        ctx.rpc.register({
          name: 'lit:timeline:push-event',
          type: 'event',
          handler: (event: unknown) => {
            pendingEvents.push(event as TimelineEvent);
          },
        });
      },
    },
  };
};
