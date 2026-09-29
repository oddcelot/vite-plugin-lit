/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Entry of the script `lit-devtools dev` serves at `/lit-devtools.js`.
 *
 * Bundled as a classic IIFE (see `src/standalone/vite.config.ts`) so a page
 * that is not served by Vite, and may be on another origin, can load it with a
 * plain `<script src>`: classic scripts load cross-origin without CORS.
 * Importing the install modules starts the capture layers and the inspector;
 * {@link connectToDevServer} then attaches the RPC carrier they announce
 * themselves through.
 *
 * The server is wherever this script came from: behind a proxy or tunnel
 * (StackBlitz, Codespaces, ngrok) that is the public address the browser used,
 * not the one the server sees itself on. `globalThis.__LIT_DEVTOOLS_CONNECT__`,
 * which the server prepends to the script, carries its connection descriptor,
 * so this page never has to `fetch` `__connection.json` (a cross-origin fetch
 * the server does not answer with CORS headers). The descriptor holds paths
 * only, so it resolves against either address. Its `url` is the fallback for
 * when the script's own address is unknown.
 */

import './timeline/install.js';
import './inspector/install.js';
import {connectToDevServer} from './rpc-transport.js';
import type {ConnectOptions} from './rpc-transport.js';

interface StandaloneConfig {
  url?: string;
  connectionMeta?: ConnectOptions['connectionMeta'];
}

const config =
  (globalThis as {__LIT_DEVTOOLS_CONNECT__?: StandaloneConfig})
    .__LIT_DEVTOOLS_CONNECT__ ?? {};

const script = document.currentScript;
const url =
  script instanceof HTMLScriptElement && script.src !== ''
    ? new URL('.', script.src).href
    : config.url;

if (url === undefined) {
  console.error(
    '[lit-devtools] cannot tell which dev server to connect to: load this ' +
      'script from the server with <script src="http://localhost:5180/lit-devtools.js">.'
  );
} else {
  connectToDevServer(url, {connectionMeta: config.connectionMeta}).then(
    () => console.info(`[lit-devtools] connected to ${url}`),
    (error) =>
      console.error(
        `[lit-devtools] could not connect to ${url}. Is \`lit-devtools dev\` ` +
          `running, and does it allow this page's origin (--allow-origin)?`,
        error
      )
  );
}
