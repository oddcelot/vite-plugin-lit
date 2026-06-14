/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Plugin, ViteDevServer} from 'vite';
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
// SSE push channel — streams batches of TimelineEvents from the server to
// the panel iframe. The panel subscribes to /__lit-timeline-events using the
// native EventSource API; the browser runtime pushes events via Vite HMR.
// ---------------------------------------------------------------------------

const PANEL_PATH = '/__lit-timeline';
const SSE_PATH = '/__lit-timeline-events';

const resolvePanel = (): string => {
  const url = new URL('../panel/index.html', import.meta.url);
  if (existsSync(url)) {
    return fileURLToPath(new URL('../panel', import.meta.url));
  }
  throw new Error('[lit-plugin:timeline] panel directory not found');
};

/** Minimal typing for Node's ServerResponse (already fully typed by `node:http`
 *  but we want to avoid pulling in @types/node in a browser runtime module). */
type SseClient = {
  write: (chunk: string) => boolean;
  on: (event: string, listener: () => void) => void;
  socket?: {destroyed?: boolean} | null;
};

const installSseMiddleware = (
  server: ViteDevServer,
  clients: Set<SseClient>
): void => {
  server.middlewares.use(
    SSE_PATH,
    (
      req: {method?: string},
      res: SseClient & {
        statusCode: number;
        setHeader: (k: string, v: string) => void;
        flushHeaders?: () => void;
      },
      next: () => void
    ) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders?.();
      res.write(':\n\n'); // keep-alive comment

      clients.add(res);
      res.on('close', () => clients.delete(res));
    }
  );
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
  const sseClients = new Set<SseClient>();

  /** Push a batch of events to all subscribed panel SSE clients. */
  const pushToPanel = (events: TimelineEvent[]): void => {
    if (sseClients.size === 0 || events.length === 0) return;
    const payload = `data: ${JSON.stringify(events)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  return {
    name: 'lit-timeline',
    apply: 'serve',

    configureServer(server) {
      // SSE endpoint: panel iframe subscribes here for event push.
      installSseMiddleware(server, sseClients);

      // Accept batches of events from the browser runtime via Vite HMR.
      server.hot.on(
        'lit:timeline:push-event',
        (data: {events?: TimelineEvent[]}) => {
          const batch = data.events ?? [];
          pushToPanel(batch);
        }
      );

      // Recording-state changes come from the panel (postMessage → parent
      // devtools → server broadcast back to app).  Phase 2 uses shared state.
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
        let panelDir: string;
        try {
          panelDir = resolvePanel();
        } catch (e) {
          console.warn(String(e));
          return;
        }

        // Serve src/panel/ static files at /__lit-timeline/.
        ctx.views.hostStatic(PANEL_PATH + '/', panelDir);

        ctx.docks.register({
          id: 'lit-timeline',
          type: 'iframe',
          title: 'Lit Timeline',
          icon: 'i-carbon-chart-line-data',
          url: PANEL_PATH + '/',
          category: 'framework',
        });

        // Phase 0 round-trip RPC — confirms devframe channel is live.
        ctx.rpc.register({
          name: 'lit:timeline:ping',
          type: 'event',
          handler: () => {
            console.log('[lit-plugin:timeline] ping received via RPC');
          },
        });
      },
    },
  };
};
