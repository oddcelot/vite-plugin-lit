/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The playground in standalone mode: built to plain static files and served
 * without Vite, feeding the panel of a `lit-devtools dev` process on another
 * port through nothing but the script tag.
 *
 *     npm run standalone                       # in this directory
 *     pnpm run standalone:demo                 # from the repo root, builds the plugin first
 *     DEMO_AUTH=1 npm run standalone           # keep the one-time-code gate
 *     DEMO_APP_PORT=8080 DEMO_DEV_PORT=5280 npm run standalone
 *
 * On StackBlitz, open the playground with `?startScript=standalone`.
 *
 * Open the two printed URLs side by side. The playground's components show up
 * in the panel's Components tab, and Record captures their updates. HMR,
 * source locations and open-in-editor need Vite and stay off here.
 *
 * `src/test/e2e/standalone-connect_test.ts` in the repo checks the same path
 * automatically.
 */

import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'vite';

const PLAYGROUND = fileURLToPath(new URL('.', import.meta.url));
const CLI = fileURLToPath(
  new URL('./node_modules/@oddsquad/vite-plugin-lit/bin.mjs', import.meta.url)
);
const OUT_DIR = path.join(tmpdir(), 'lit-devtools-standalone-playground');

// On StackBlitz the plugin is the published one, which may predate the
// served script; say so rather than serve a page that never connects.
if (
  !existsSync(new URL('dist/standalone/lit-devtools.js', pathToFileURL(CLI)))
) {
  const {version} = JSON.parse(
    await readFile(new URL('package.json', pathToFileURL(CLI)), 'utf8')
  );
  console.error(
    `[standalone] @oddsquad/vite-plugin-lit ${version} has no standalone ` +
      `script (dist/standalone/lit-devtools.js). It needs a release that ` +
      `ships standalone mode; in the repo, run \`pnpm run build\` first.`
  );
  process.exit(1);
}
const AUTH = process.env['DEMO_AUTH'] !== undefined;

// StackBlitz serves every port of a project from its own origin, which is
// only known once the project boots, so the dev server admits the whole
// WebContainer domain. Loopback origins are allowed anyway.
const WEBCONTAINER_ORIGINS = 'https://*.webcontainer-api.io';

/** Whether `port` can be bound on localhost right now. */
const isFree = (port) =>
  new Promise((resolve) => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, 'localhost', () => probe.close(() => resolve(true)));
  });

/**
 * The port named in `env` as given, or else the first free one from `start`
 * up: the defaults are common enough (another project's Vite, a devframe
 * left running) that failing on a taken one would be the usual outcome.
 */
const pickPort = async (env, start, skip) => {
  if (process.env[env] !== undefined) return Number(process.env[env]);
  for (let port = start; port < start + 50; port++) {
    if (port !== skip && (await isFree(port))) return port;
  }
  throw new Error(`no free port in ${start}-${start + 49}; set ${env}`);
};

const DEV_PORT = await pickPort('DEMO_DEV_PORT', 5180);
const APP_PORT = await pickPort('DEMO_APP_PORT', 5181, DEV_PORT);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

console.log('[standalone] building the playground as static files…');
await build({
  root: PLAYGROUND,
  logLevel: 'warn',
  build: {outDir: OUT_DIR, emptyOutDir: true},
});

// Passed through to the terminal, so the one-time code shows when DEMO_AUTH
// is set. Without it the gate is off, as in the Vite playground: this is a
// throwaway demo server, and on StackBlitz nobody can read the code off a
// terminal in time. Do not copy that into a real project.
const cli = spawn(
  process.execPath,
  [
    CLI,
    'dev',
    '--port',
    String(DEV_PORT),
    '--allow-origin',
    WEBCONTAINER_ORIGINS,
    ...(AUTH ? [] : ['--no-auth']),
  ],
  {cwd: PLAYGROUND, stdio: ['inherit', 'pipe', 'inherit']}
);
await new Promise((resolve, reject) => {
  let output = '';
  cli.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    output += chunk.toString();
    if (output.includes('/lit-devtools.js">')) resolve();
  });
  cli.on('exit', (code) =>
    reject(new Error(`lit-devtools dev exited with code ${code}`))
  );
});

// The script tag, written by the page itself: the dev server's address is
// only known in the browser. Locally it is the page's host on the dev port;
// on StackBlitz the port is a `--<port>--` segment of the host.
const loader = `<script>
      (() => {
        const port = ${DEV_PORT};
        const host = /--\\d+--/.test(location.host)
          ? location.host.replace(/--\\d+--/, '--' + port + '--')
          : location.hostname + ':' + port;
        const script = document.createElement('script');
        script.src = location.protocol + '//' + host + '/lit-devtools.js';
        document.head.append(script);
      })();
    </script>`;

// Not Vite: a bare static server.
const app = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  const file = path.join(OUT_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(OUT_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(file);
    if (file.endsWith('.html')) {
      body = body.toString().replace('<head>', `<head>\n    ${loader}`);
    }
    res.setHeader(
      'content-type',
      TYPES[path.extname(file)] ?? 'application/octet-stream'
    );
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve, reject) => {
  app.once('error', reject);
  app.listen(APP_PORT, 'localhost', resolve);
});

console.log(
  `\n[standalone] page (static, no Vite): http://localhost:${APP_PORT}/\n` +
    `[standalone] panel:                  http://localhost:${DEV_PORT}/\n` +
    (AUTH
      ? `[standalone] the page asks for the one-time code printed above\n`
      : '') +
    `[standalone] Ctrl+C to stop\n`
);

const stop = async () => {
  cli.kill();
  app.close();
  await rm(OUT_DIR, {recursive: true, force: true});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
