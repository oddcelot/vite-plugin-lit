/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Hands-on demo of the standalone mode: the playground, built to plain static
 * files and served without Vite, feeding the panel of a `lit-devtools dev`
 * process on another port through nothing but the script tag.
 *
 *     pnpm run standalone:demo                 # builds the plugin first
 *     DEMO_AUTH=1 pnpm run standalone:demo     # keep the one-time-code gate
 *     DEMO_APP_PORT=8080 DEMO_DEV_PORT=5280 pnpm run standalone:demo
 *
 * Open the two printed URLs side by side. The playground's components show up
 * in the panel's Components tab, and Record captures their updates. HMR,
 * source locations and open-in-editor need Vite and stay off here.
 *
 * `src/test/e2e/standalone-connect_test.ts` checks the same path automatically.
 */

import {spawn} from 'node:child_process';
import {readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAYGROUND = path.join(ROOT, 'playground');
const OUT_DIR = path.join(tmpdir(), 'lit-devtools-standalone-demo');
const DEV_PORT = Number(process.env['DEMO_DEV_PORT'] ?? 5180);
const APP_PORT = Number(process.env['DEMO_APP_PORT'] ?? 5181);
const AUTH = process.env['DEMO_AUTH'] !== undefined;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

console.log('[demo] building the playground as static files…');
await build({
  root: PLAYGROUND,
  logLevel: 'warn',
  build: {outDir: OUT_DIR, emptyOutDir: true},
});

// Passed through to the terminal, so the one-time code shows when DEMO_AUTH
// is set; the origin is read from the script tag the CLI prints.
const cli = spawn(
  process.execPath,
  [
    path.join(ROOT, 'bin.mjs'),
    'dev',
    '--port',
    String(DEV_PORT),
    ...(AUTH ? [] : ['--no-auth']),
  ],
  {cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit']}
);
const devOrigin = await new Promise((resolve, reject) => {
  let output = '';
  cli.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    output += chunk.toString();
    const match = /<script src="(http:\/\/[^"]+)\/lit-devtools\.js">/.exec(
      output
    );
    if (match !== null) resolve(match[1]);
  });
  cli.on('exit', (code) =>
    reject(new Error(`lit-devtools dev exited with code ${code}`))
  );
});

// Not Vite: a bare static server. The devtools script goes first in <head>,
// so its `customElements.define` hook is in place before the app's module
// scripts define anything.
const tag = `<script src="${devOrigin}/lit-devtools.js"></script>`;
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
      body = body.toString().replace('<head>', `<head>\n    ${tag}`);
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
  `\n[demo] page (static, no Vite): http://localhost:${APP_PORT}/\n` +
    `[demo] panel:                  ${devOrigin}/\n` +
    (AUTH ? `[demo] the page asks for the one-time code printed above\n` : '') +
    `[demo] Ctrl+C to stop\n`
);

const stop = async () => {
  cli.kill();
  app.close();
  await rm(OUT_DIR, {recursive: true, force: true});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
