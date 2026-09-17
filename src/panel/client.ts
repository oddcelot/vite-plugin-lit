/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The panel's single connection to the node side.
 *
 * The panel is served by the devframe host as a static SPA, so
 * `connectDevframe()` discovers the node side from the page URL — it reads
 * `__connection.json` next to `document.baseURI`, then dials the host's
 * WebSocket and completes the trust handshake. Every view shares one
 * connection through {@link litRpc}; opening a second would mean a second
 * socket and a second handshake.
 *
 * Replaces the old transport, where each view opened its own `EventSource`
 * against `/__lit-devtools-events` and POSTed to bespoke endpoints.
 */

import {connectDevframe} from 'devframe/client';
import type {DevframeScopedClientContext} from 'devframe/client';
import type {SettingsForNamespace} from 'devframe';
import {LIT_DEVFRAME_ID} from '../lib/devframe/protocol.js';
import type {LitGetMetaResult} from '../lib/devframe/protocol.js';

/**
 * The `lit:`-scoped client. The second parameter is what makes
 * `client.settings` typed against `DevframeSettingsRegistry.lit` (see
 * `lib/devframe/protocol.ts`) instead of a bare `Record<string, any>` —
 * `client.scope()` infers it, but this alias has to say so.
 */
export type LitClient = DevframeScopedClientContext<
  typeof LIT_DEVFRAME_ID,
  SettingsForNamespace<typeof LIT_DEVFRAME_ID>
>;

let connecting: Promise<LitClient> | undefined;

/**
 * The shared, `lit:`-scoped RPC client. Connects on first call; every later
 * call awaits the same connection.
 *
 * Rejects if the handshake never completes (the host is gone, or trust was
 * denied). Callers render an error state rather than retrying: the panel is
 * an iframe the developer can reload.
 */
export const litRpc = (): Promise<LitClient> =>
  (connecting ??= (async () => {
    const client = await connectDevframe();
    // The host mints a token per browser; until it does, calls would fail
    // with an auth error rather than waiting.
    await client.ensureTrusted();
    return client.scope(LIT_DEVFRAME_ID);
  })());

/** One-shot metadata: version, layer list, resolved settings, stream address. */
export const getMeta = async (): Promise<LitGetMetaResult> => {
  const rpc = await litRpc();
  return rpc.rpc.call('get-meta');
};

/**
 * Formats a connection failure for display. `DevframeConnectionError` carries
 * a `type` of `'connection' | 'auth' | 'timeout'`; anything else is shown as
 * its message.
 */
export const describeError = (error: unknown): string => {
  if (error && typeof error === 'object' && 'type' in error) {
    const type = (error as {type: unknown}).type;
    if (type === 'auth') {
      return 'DevTools denied this panel access. Approve the connection in your terminal, then reload.';
    }
    if (type === 'timeout') {
      return 'The Lit plugin did not answer in time. Is the dev server still running?';
    }
    if (type === 'connection') {
      return 'Lost the connection to the dev server. Reload the panel once it is back.';
    }
  }
  return error instanceof Error ? error.message : String(error);
};
