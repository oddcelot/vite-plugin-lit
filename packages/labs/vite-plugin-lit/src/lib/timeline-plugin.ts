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
import {
  SETTINGS_OVERRIDE_CHANNEL,
  type FeatureSettings,
  type SettingsOverride,
  type TimelineEvent,
  type TimelineLayer,
} from '../types/timeline.js';
import {
  INSPECT_CMD_CHANNEL,
  INSPECT_DATA_CHANNEL,
  INSPECT_OVERLAY_TOGGLE_CHANNEL,
  INSPECT_PATH,
  INSPECT_SSE_EVENT,
  type InspectorCommand,
  type InspectorMessage,
} from '../types/inspector.js';

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

/** Subset of @devframes/hub's command-input we register. */
interface CommandInput {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  category?: string;
  keybindings?: Array<{key: string}>;
  handler?: (...args: unknown[]) => unknown;
}

interface TimelineCtx {
  docks: {register: (entry: DockEntry) => unknown};
  commands?: {register: (command: CommandInput) => unknown};
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
// the panel iframe. The panel subscribes to /__lit-devtools-events using the
// native EventSource API; the browser runtime pushes events via Vite HMR.
// ---------------------------------------------------------------------------

const PANEL_PATH = '/__lit-devtools';
const SSE_PATH = '/__lit-devtools-events';
const CONTROL_PATH = '/__lit-devtools-control';
/** Read-only feature settings consumed by the panel's Settings tab. */
const SETTINGS_PATH = '/__lit-devtools-settings';

// The official Lit logo mark (Iconify `logos:lit-icon`). Its native viewBox is
// 256×320 — taller than wide — so when the DevTools dock sizes an icon to its
// width it overflowed the square slot and looked bigger than the other icons.
// We pad it to a square viewBox (-32 0 320 320, centering the 256-wide art) so
// it renders at the same box size as the built-in phosphor icons. Inlined as a
// data: URI rather than `logos:lit-icon` so it also works offline (no Iconify
// API fetch).
const LIT_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 0 320 320">' +
  '<path fill="#00e8ff" d="m64 192l25.926-44.727l38.233-19.114l63.974 63.974l10.833 61.754L192 320l-64-64l-38.074-25.615z"/>' +
  '<path fill="#283198" d="M128 256V128l64-64v128zM0 256l64 64l9.202-60.602L64 192l-37.542 23.71z"/>' +
  '<path fill="#324fff" d="M64 192V64l64-64v128zm128 128V192l64-64v128zM0 256V128l64 64z"/>' +
  '<path fill="#0ff" d="M64 320V192l64 64z"/></svg>';
const LIT_LOGO_ICON = `data:image/svg+xml,${encodeURIComponent(LIT_LOGO_SVG)}`;

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

/** Subset of Node's readable-stream `on` used to collect a request body. */
type ReadableOn = (event: string, handler: (chunk: Buffer) => void) => void;

/**
 * Reads and JSON-parses a request body, invoking `done` with the parsed object
 * (or `null` on a malformed/empty body). Used by the control + settings POST
 * endpoints.
 */
const readJsonBody = (
  req: {on?: ReadableOn},
  done: (body: Record<string, unknown> | null) => void
): void => {
  const chunks: Buffer[] = [];
  req.on?.('data', (chunk) => chunks.push(chunk));
  req.on?.('end', () => {
    try {
      done(
        JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
      );
    } catch {
      done(null);
    }
  });
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

export const litTimelinePlugin = (
  getSettings?: () => FeatureSettings | undefined
): Plugin => {
  const sseClients = new Set<SseClient>();
  // Captured in configureServer so the (server-side) DevTools command handler
  // can broadcast to the app runtime; it only runs after the server is up.
  let devServer: ViteDevServer | undefined;

  /** Write a pre-framed SSE payload to every client, pruning dead sockets. */
  const broadcast = (payload: string): void => {
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  /** Push a batch of events to all subscribed panel SSE clients. */
  const pushToPanel = (events: TimelineEvent[]): void => {
    if (sseClients.size === 0 || events.length === 0) return;
    broadcast(`data: ${JSON.stringify(events)}\n\n`);
  };

  /** Push a named SSE event (the panel listens via `addEventListener(name)`). */
  const pushEvent = (name: string, data: unknown): void => {
    if (sseClients.size === 0) return;
    broadcast(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  return {
    name: 'lit-devtools',
    apply: 'serve',

    configureServer(server) {
      devServer = server;
      // SSE endpoint: panel iframe subscribes here for event push.
      installSseMiddleware(server, sseClients);

      // Settings endpoint. GET returns the resolved feature settings (the
      // baseline the panel renders). POST carries a SettingsOverride which we
      // rebroadcast to the app runtime via HMR so it takes effect live.
      server.middlewares.use(
        SETTINGS_PATH,
        (
          req: {method?: string; on?: ReadableOn},
          res: {
            statusCode: number;
            setHeader: (k: string, v: string) => void;
            end: (body?: string) => void;
          },
          next: () => void
        ) => {
          if (req.method === 'GET') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(JSON.stringify(getSettings?.() ?? null));
            return;
          }
          if (req.method === 'POST') {
            readJsonBody(req, (body) => {
              if (body !== null) {
                server.hot.send(
                  SETTINGS_OVERRIDE_CHANNEL,
                  body as SettingsOverride
                );
              }
              res.statusCode = 204;
              res.end();
            });
            return;
          }
          next();
        }
      );

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

      // Control endpoint: the panel POSTs recording/layer state changes here.
      // The server rebroadcasts the state to all connected app tabs via HMR.
      server.middlewares.use(CONTROL_PATH, (req, res, next) => {
        const method = (req as {method?: string}).method;
        if (method !== 'POST') {
          next();
          return;
        }
        readJsonBody(req as {on?: ReadableOn}, (body) => {
          if (body !== null) {
            if (typeof body.recording === 'boolean') {
              server.hot.send('lit:timeline:recording-changed', {
                recording: body.recording,
              });
            }
            const layerKeys = [
              'litLifecycleEnabled',
              'litRenderEnabled',
              'mouseEventEnabled',
              'keyboardEventEnabled',
            ] as const;
            const layersUpdate: Record<string, boolean> = {};
            for (const key of layerKeys) {
              if (typeof body[key] === 'boolean') {
                layersUpdate[key] = body[key] as boolean;
              }
            }
            if (Object.keys(layersUpdate).length > 0) {
              server.hot.send('lit:timeline:layers-changed', layersUpdate);
            }
          }
          const r = res as {statusCode: number; end: () => void};
          r.statusCode = 204;
          r.end();
        });
      });

      // Accept batches of events from the browser runtime via Vite HMR.
      server.hot.on(
        'lit:timeline:push-event',
        (data: {events?: TimelineEvent[]}) => {
          pushToPanel(data.events ?? []);
        }
      );

      // Legacy: panel postMessage → devtools shell → server (keep for compat).
      server.hot.on(
        'lit:timeline:set-recording',
        (data: {recording: boolean}) => {
          server.hot.send('lit:timeline:recording-changed', {
            recording: data.recording,
          });
        }
      );

      // Custom layer announced by app code via addTimelineLayer().
      // Forward to the panel as a named SSE event so it can add the layer.
      server.hot.on(
        'lit:timeline:custom-layer',
        (data: {layer: TimelineLayer}) => {
          if (!data.layer?.id) return;
          pushEvent('layer', data.layer);
        }
      );

      // Components inspector. The panel POSTs an InspectorCommand here; we
      // forward it to the app runtime over HMR. The runtime answers over
      // INSPECT_DATA_CHANNEL, which we relay to the panel as a named SSE event.
      server.middlewares.use(INSPECT_PATH, (req, res, next) => {
        const method = (req as {method?: string}).method;
        if (method !== 'POST') {
          next();
          return;
        }
        readJsonBody(req as {on?: ReadableOn}, (body) => {
          if (body !== null) {
            // "Pick" starts the overlay's inspect picker (a server-side toggle),
            // not a runtime query, so it's routed to the overlay channel.
            if ((body as InspectorCommand).type === 'pick') {
              server.hot.send(INSPECT_OVERLAY_TOGGLE_CHANNEL);
            } else {
              server.hot.send(INSPECT_CMD_CHANNEL, body as InspectorCommand);
            }
          }
          const r = res as {statusCode: number; end: () => void};
          r.statusCode = 204;
          r.end();
        });
      });

      server.hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
        pushEvent(INSPECT_SSE_EVENT, data);
      });
    },

    devtools: {
      setup(ctx: TimelineCtx) {
        // Register the dock entry. HTML is served by the configureServer
        // middleware above (with /@fs/ injection); hostStatic is not used.
        ctx.docks.register({
          id: 'lit-devtools',
          type: 'iframe',
          // This dock represents the whole Lit plugin (HMR, source overlay,
          // timeline), so it's branded "Lit" rather than the timeline panel
          // it currently opens.
          title: 'Lit',
          // Square, inlined Lit logo — see LIT_LOGO_ICON above. DevTools renders
          // a `data:` icon directly as an <img>, no Iconify API fetch.
          icon: LIT_LOGO_ICON,
          url: PANEL_PATH + '/',
          category: 'framework',
        });

        // Register the overlay toggle as a DevTools command so it shows in the
        // command palette and as a managed shortcut. The handler runs
        // server-side; it broadcasts to the app runtime, which toggles the
        // overlay. Only meaningful when the overlay is enabled.
        const so = getSettings?.()?.sourceOverlay;
        if (so?.enabled && ctx.commands?.register) {
          ctx.commands.register({
            id: 'lit:overlay:toggle',
            title: 'Pick Lit Element',
            description:
              'Click to inspect in the Components panel, hold Meta/Ctrl and click to open in your editor',
            icon: 'ph:crosshair-duotone',
            category: 'Lit',
            keybindings: [{key: 'Meta+Shift+E'}],
            handler: () => devServer?.hot.send(INSPECT_OVERLAY_TOGGLE_CHANNEL),
          });
        }
      },
    },
  };
};
