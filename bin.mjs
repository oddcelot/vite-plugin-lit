#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

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
 * @see plans/roadmap/03-cli-and-stdio-mcp.md
 */

import process from 'node:process';
import {createLitDevframe} from './lib/devframe/definition.js';
import {createNullSource} from './lib/devframe/source.js';
import {PACKAGE_VERSION} from './lib/devframe/paths.js';

/**
 * Standalone `dev` default port. Deliberately *not* the playground's 5179
 * (`playground/vite.config.ts`): running `pnpm run dev` and `lit-devtools
 * dev` against the same checkout is a normal thing to do while working on
 * this package, and two servers fighting over one port is a worse first
 * experience than a port nobody has to think about.
 */
const DEFAULT_DEV_PORT = 5180;

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
    .command('dev', 'Start a standalone devframe dev server (no page attached)')
    .option('--port <port>', 'Port to listen on', {default: DEFAULT_DEV_PORT})
    .option('--host <host>', 'Host to bind to', {default: 'localhost'})
    .option('--open', 'Open the browser on start')
    .action(async (flags) => {
      const {createDevServer} = await import('devframe/adapters/dev');
      // A standalone server has no Vite and no page, so the component tree
      // is empty by construction. This command is a framework-neutrality
      // harness for the definition, not a way to inspect a real app --
      // for that, run your Vite dev server with DevTools enabled.
      await createDevServer(
        createLitDevframe({
          source: createNullSource(),
          version: PACKAGE_VERSION,
        }),
        {
          host: flags.host,
          port: Number(flags.port),
          flags: {open: Boolean(flags.open)},
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
      // the data; see plans/roadmap/08-static-snapshot.md.
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
