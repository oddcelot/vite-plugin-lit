/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
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

interface PanelPaths {
  /** Directory that contains index.html. */
  htmlDir: string;
  /** Absolute path to the panel entry module (.ts in dev, .js in published). */
  appModule: string;
}

/**
 * Resolves the panel files, checking the compiled output first (`panel/`) then
 * the TypeScript source (`src/panel/`). In dev, the source `.ts` file is
 * served via Vite's /@fs/ handler so TypeScript is compiled on the fly.
 */
const resolvePanel = (): PanelPaths => {
  for (const [htmlRel, appRel] of [
    ['../panel/index.html', '../panel/timeline-app.js'],
    ['../src/panel/index.html', '../src/panel/timeline-app.ts'],
  ] as const) {
    const htmlUrl = new URL(htmlRel, import.meta.url);
    if (existsSync(htmlUrl)) {
      const htmlDir = fileURLToPath(new URL('.', htmlUrl));
      const appModule = fileURLToPath(new URL(appRel, import.meta.url));
      return {htmlDir, appModule};
    }
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

      // Serve the panel HTML with the Lit SPA entry injected via /@fs/ so
      // Vite can transform the TypeScript source on the fly.
      let panel: PanelPaths | undefined;
      try {
        panel = resolvePanel();
      } catch (e) {
        console.warn(String(e));
      }

      if (panel !== undefined) {
        const {htmlDir, appModule} = panel;
        server.middlewares.use(
          PANEL_PATH,
          async (
            req: {url?: string},
            res: {
              statusCode: number;
              setHeader: (k: string, v: string) => void;
              end: (body: string) => void;
            },
            next: () => void
          ) => {
            const url = req.url ?? '/';
            if (url !== '/' && url !== '' && url !== '/index.html') {
              next();
              return;
            }
            let html: string;
            try {
              html = await readFile(join(htmlDir, 'index.html'), 'utf-8');
            } catch {
              next();
              return;
            }
            // Inject the panel entry as a /@fs/ module so Vite's transform
            // pipeline compiles TypeScript and resolves bare specifiers (lit, etc).
            const scriptTag = `  <script type="module" src="/@fs${appModule}"></script>\n`;
            html = html.replace('</body>', scriptTag + '</body>');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          }
        );
      }

      // Accept batches of events from the browser runtime via Vite HMR.
      server.hot.on(
        'lit:timeline:push-event',
        (data: {events?: TimelineEvent[]}) => {
          pushToPanel(data.events ?? []);
        }
      );

      // Recording-state changes come from the panel (postMessage → parent
      // devtools shell → server), broadcast back to all connected app tabs.
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
        // Register the dock entry. HTML is served by the configureServer
        // middleware above (with /@fs/ injection); hostStatic is not used.
        ctx.docks.register({
          id: 'lit-timeline',
          type: 'iframe',
          title: 'Lit Timeline',
          icon: 'i-carbon-chart-line-data',
          url: PANEL_PATH + '/',
          category: 'framework',
        });

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
