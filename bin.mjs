#!/usr/bin/env node
/**
 * `lit-devtools` — the package's command line.
 *
 * Built on a bare `cac()` instance rather than devframe's `createCac()`
 * adapter, deliberately. Two things make the wrapper the wrong fit here:
 *
 * 1. Its `mcp` subcommand runs `createMcpServer(definition, ...)`, which
 *    executes the definition's `setup()` fresh and in-process. This
 *    package's definition reads a `TimelineSource`, and a CLI has no page
 *    to attach — so that server would answer every component query with an
 *    empty list, forever, while looking perfectly healthy. An MCP server
 *    that is confidently wrong is worse than no MCP server. The `mcp`
 *    command below proxies an *already-running* dev server instead.
 * 2. It registers `dev` as cac's default command (`[...args]`), not a named
 *    one, and cac resolves commands first-match-wins — so its built-in
 *    subcommands cannot be cleanly overridden after the fact, only spliced
 *    out of `cli.commands`. Hand-rolling is less code than fighting that.
 *
 * `cac` and `@devframes/agentic` are optional peers, imported dynamically
 * and only on the path that needs them, so installing this package without
 * them stays supported.
 *
 * @see plans/devtools-features.md (CLI and stdio MCP)
 */

import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {resolveAllowedOrigins} from './lib/devframe/allowed-origins.js';
import {createStandaloneLitDevframe} from './lib/devframe/rpc-source.js';
import {PACKAGE_VERSION, PANEL_DIST_DIR} from './lib/devframe/paths.js';

/**
 * Standalone `dev` default port. Deliberately *not* the playground's 5179
 * (`playground/vite.config.ts`): running `pnpm run dev` and `lit-devtools
 * dev` against the same checkout is a normal thing to do while working on
 * this package, and two servers fighting over one port is a worse first
 * experience than a port nobody has to think about.
 */
const DEFAULT_DEV_PORT = 5180;

/** The script pages outside Vite load; built by `build:standalone`. */
const STANDALONE_SCRIPT = new URL(
  './dist/standalone/lit-devtools.js',
  import.meta.url
);

/** True for a host only this machine can reach. */
const isLoopbackHost = (host) =>
  host === 'localhost' ||
  host === '::1' ||
  host === '[::1]' ||
  /^127\.\d+\.\d+\.\d+$/.test(host);

/** Fail with a readable message instead of a module-resolution stack trace. */
const requirePeer = async (specifier, hint) => {
  try {
    return await import(specifier);
  } catch {
    console.error(
      `[lit-devtools] this command needs the optional peer "${hint}". ` +
        `Install it and retry:\n\n  npm install -D ${hint}\n`
    );
    process.exit(1);
  }
};

const main = async () => {
  const {default: cac} = await requirePeer('cac', 'cac');
  const cli = cac('lit-devtools');

  cli
    .command(
      'dev',
      'Start a standalone devframe dev server that pages connect to'
    )
    .option('--port <port>', 'Port to listen on', {default: DEFAULT_DEV_PORT})
    .option('--host <host>', 'Host to bind to', {default: 'localhost'})
    .option('--open', 'Open the browser on start')
    .option(
      '--allow-origin <origin>',
      'Also let pages served from this origin connect, e.g. ' +
        'https://myapp.test:8443, or https://*.webcontainer-api.io for any ' +
        'host under a domain. Loopback origins on any port are always ' +
        'allowed. Repeatable.'
    )
    .option(
      '--no-auth',
      'Skip the one-time-code gate, so a page can connect without a token'
    )
    .action(async (flags) => {
      // Without the code gate, anything that can reach the port drives the
      // panel's RPC: it can read the session and open project files in the
      // developer's editor. On loopback that is this machine; on any other
      // host it is the network.
      if (flags.auth === false && !isLoopbackHost(String(flags.host))) {
        console.error(
          `[lit-devtools] --no-auth needs a loopback host, and ` +
            `${flags.host} is reachable from other machines. Drop ` +
            `--no-auth (pages then ask for the one-time code) or bind to ` +
            `localhost.`
        );
        process.exit(1);
      }
      const {createDevServer} = await import('devframe/adapters/dev');
      // A standalone server has no Vite, so it has no page of its own: the
      // panel stays empty until a page dials in. It gets there by loading
      // `/lit-devtools.js` (served below), which starts the runtime and calls
      // `connectToDevServer()` (see `lib/runtime/rpc-transport.ts`). HMR
      // patching and source metadata need Vite's transforms and are not part
      // of it.
      let allowedOrigins;
      try {
        allowedOrigins = resolveAllowedOrigins(
          [flags.allowOrigin]
            .flat()
            .filter((origin) => origin != null)
            .map(String)
        );
      } catch (error) {
        console.error(`[lit-devtools] ${error.message}`);
        process.exit(1);
      }
      let server;
      const serveScript = async () => {
        const headers = {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        };
        let bundle;
        try {
          bundle = await readFile(STANDALONE_SCRIPT, 'utf8');
        } catch {
          return new Response(
            '// lit-devtools: the standalone script is not built. ' +
              'Run `pnpm run build` in the package and restart.\n',
            {status: 500, headers}
          );
        }
        // The descriptor `__connection.json` would answer with, inlined so the
        // page never fetches it: that request is cross-origin from a page
        // that is not on this server, and gets no CORS headers. Picked, not
        // spread, so nothing else devframe puts in it rides along to any page
        // that can load a script tag.
        const {backend, websocket, sse} = server.connectionMeta();
        const config = {
          url: server.origin + '/',
          connectionMeta: {backend, websocket, sse},
        };
        return new Response(
          `globalThis.__LIT_DEVTOOLS_CONNECT__ = ${JSON.stringify(config)};\n${bundle}`,
          {headers}
        );
      };
      // devframe mounts a static catch-all that answers 404 for paths it
      // does not know, so a route added to its app in `onReady` would never be
      // reached. The route has to go on the app *before* devframe's, which
      // means handing it one -- built from the copy of h3 devframe itself
      // resolves, so the two agree on the class.
      const devframeRequire = createRequire(
        import.meta.resolve('devframe/adapters/dev')
      );
      const {H3} = await import(
        pathToFileURL(devframeRequire.resolve('h3')).href
      );
      const app = new H3();
      app.use('/lit-devtools.js', serveScript);
      server = await createDevServer(
        createStandaloneLitDevframe({
          version: PACKAGE_VERSION,
          clientAssets: PANEL_DIST_DIR,
        }),
        {
          host: flags.host,
          port: Number(flags.port),
          flags: {open: Boolean(flags.open), auth: flags.auth},
          app,
          ...(allowedOrigins !== undefined ? {allowedOrigins} : {}),
          onReady({origin}) {
            console.log(
              `\n[lit-devtools] Add this to a page to connect it:\n\n` +
                `  <script src="${origin}/lit-devtools.js"></script>\n`
            );
          },
        }
      );
    });

  cli
    .command('build', 'Explain how to export a static snapshot of a session')
    .action(() => {
      // Deliberately not implemented here. A snapshot worth attaching to an
      // issue is a *recorded session*, and the session lives in the running
      // dev server's memory -- a fresh CLI process has no page, no timeline
      // and no component tree, so anything it could build would be an empty
      // shell. The export therefore runs inside the dev server that holds
      // the data; see plans/devtools-features.md.
      console.error(
        `[lit-devtools] A static snapshot is exported from a running ` +
          `session, not from this CLI.\n` +
          `Record what you want to report in the DevTools Lit panel, then ` +
          `press "Export snapshot" in the Timeline tab. The dev server ` +
          `writes a self-contained panel directory you can zip onto an issue.`
      );
      process.exit(1);
    });

  cli
    .command('mcp', 'Start a stdio MCP server proxying running dev servers')
    .option(
      '--port <port>',
      'Also probe this port for an instance the registry does not list. ' +
        'Probes <origin>/__connection.json at the ROOT path only, so this ' +
        'finds a standalone "lit-devtools dev" server but NOT a ' +
        'Vite-hosted one (mounted under /__devtools/) -- for those, rely ' +
        'on registry discovery. Repeatable.'
    )
    .option(
      '--token <token>',
      'Bearer token presented to each instance MCP route, for a dev server ' +
        'whose DevTools auth gate is enabled.'
    )
    .action(async (flags) => {
      const {startConnectServer} = await requirePeer(
        '@devframes/agentic/connect',
        '@devframes/agentic'
      );
      // This is devframe's own generic connector: it discovers every
      // devframe instance on the machine, not just this package's. Its two
      // gateway tools (`devframe_connect_list-instances` /
      // `devframe_connect_call-tool`) are how an agent reaches the `lit_*`
      // tools, one hop in.
      const ports = [flags.port]
        .flat()
        .filter((p) => p != null)
        .map(Number)
        .filter((p) => Number.isInteger(p) && p > 0);

      await startConnectServer({
        ...(ports.length > 0 ? {ports} : {}),
        ...(flags.token ? {authToken: String(flags.token)} : {}),
      });
    });

  cli.help();
  cli.version(PACKAGE_VERSION);

  cli.parse(process.argv, {run: false});
  await cli.runMatchedCommand();
};

main().catch((error) => {
  console.error(`[lit-devtools] ${error?.stack ?? error}`);
  process.exit(1);
});
