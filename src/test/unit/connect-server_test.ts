/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, describe, expect, test, vi} from 'vite-plus/test';
import {createDevServer} from 'devframe/adapters/dev';
import {getDevframeRpcClient} from 'devframe/client';
import {createStandaloneLitDevframe} from '../../lib/devframe/rpc-source.js';
import {connectToDevServer} from '../../lib/runtime/rpc-transport.js';
import {pageChannel} from '../../lib/runtime/page-channel.js';
import {INSPECT_DATA_CHANNEL} from '../../types/inspector.js';
import {LIT_DEVFRAME_ID} from '../../lib/devframe/protocol.js';

// The page half of the standalone flow against a real `createDevServer`: a
// page that was handed the server's connection descriptor (so it never
// fetches `__connection.json`) dials in over a real WebSocket, and traffic
// flows both ways. Only the browser globals devframe's client reads are faked.
// (No `node:` imports here: the pre-commit hook's single-file check can't type
// them under `src/test/`.)

type Server = Awaited<ReturnType<typeof createDevServer>>;
let server: Server;
const disconnects: Array<() => void> = [];

beforeAll(async () => {
  server = await createDevServer(
    createStandaloneLitDevframe({version: '9.9.9', features: () => null}),
    {
      host: '127.0.0.1',
      port: 0,
      flags: {open: false, auth: false},
      openBrowser: false,
    }
  );
  const store = new Map<string, string>();
  vi.stubGlobal('location', new URL(server.origin));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

afterAll(async () => {
  for (const disconnect of disconnects) disconnect();
  vi.unstubAllGlobals();
  await server?.close();
});

describe('connectToDevServer with a connection descriptor', () => {
  test('carries page messages to the server and its commands back', async () => {
    const meta = server.connectionMeta();
    const fetched = vi.spyOn(globalThis, 'fetch');

    const recording: unknown[] = [];
    pageChannel.on('lit:timeline:recording-changed', (d) => recording.push(d));

    disconnects.push(
      await connectToDevServer(server.origin, {connectionMeta: meta})
    );
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();

    // Page -> server: an inspector tree lands in the session.
    const panel = await getDevframeRpcClient({
      baseURL: server.origin,
      connectionMeta: meta,
    });
    disconnects.push(() => panel.close?.());
    await panel.ensureTrusted();
    const rpc = panel.scope(LIT_DEVFRAME_ID).rpc;

    const roots = [{id: 1, tagName: 'x-a', children: []}];
    pageChannel.send(INSPECT_DATA_CHANNEL, {type: 'tree', roots});
    await vi.waitFor(async () =>
      expect(await rpc.call('list-components')).toEqual(roots)
    );

    // Server -> page: turning recording on reaches the page's listener.
    await rpc.call('set-recording', {recording: true});
    await vi.waitFor(() => expect(recording).toContainEqual({recording: true}));
  });
});
