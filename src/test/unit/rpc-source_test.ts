import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {initDevframe} from 'devframe/initiate';
import type {DevframeInstance} from 'devframe/initiate';
import {INSPECT_DATA_CHANNEL} from '../../types/inspector.js';
import {createStandaloneLitDevframe} from '../../lib/devframe/rpc-source.js';
import {createRpcTransport} from '../../lib/runtime/rpc-transport.js';
import type {PageRpc} from '../../lib/runtime/rpc-transport.js';

// The host's end of the RPC pipe, against a real node context. What the
// codec does with each channel is `page-codec_test.ts`'s.

let instance: DevframeInstance | undefined;
afterEach(async () => {
  await instance?.close();
  instance = undefined;
});

describe('createStandaloneLitDevframe', () => {
  test('registers page-send and routes a page message to the session', async () => {
    const def = createStandaloneLitDevframe({
      host: 'standalone',
      version: '9.9.9',
      features: () => null,
    });
    instance = initDevframe(def, {
      base: '/__lit/',
      distDir: false,
      ws: false,
      sse: false,
      getStorageDir: () => './node_modules/.tmp-lit-devframe-test',
    });
    const ctx = await instance.context;
    await instance.ready;
    expect(ctx.rpc.list()).toContain('lit:page-send');

    const roots = [{id: 1, tagName: 'x-a', children: []}];
    await ctx.rpc.invokeLocal('lit:page-send', INSPECT_DATA_CHANNEL, {
      type: 'tree',
      roots,
    });
    expect(await ctx.rpc.invokeLocal('lit:list-components')).toEqual(roots);
    // `lit-devtools.js` brings its own picker, so the panel offers Pick.
    expect((await ctx.rpc.invokeLocal('lit:get-meta')).picker).toBe(true);
  });

  test("sends the host's commands to every page as page-receive", async () => {
    instance = initDevframe(
      createStandaloneLitDevframe({host: 'standalone', version: '9.9.9'}),
      {
        base: '/__lit/',
        distDir: false,
        ws: false,
        sse: false,
        getStorageDir: () => './node_modules/.tmp-lit-devframe-test',
      }
    );
    const ctx = await instance.context;
    await instance.ready;
    const broadcast = vi.spyOn(ctx.rpc, 'broadcast');
    await ctx.rpc.invokeLocal('lit:inspect', {type: 'tree'});
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'lit:page-receive',
        args: ['lit:inspect:cmd', {type: 'tree'}],
        event: true,
      })
    );
  });
});

// The page half: the same channel over an RPC client.

const fakeRpc = () => {
  const called: unknown[][] = [];
  let receive!: (...args: any[]) => void;
  const rpc: PageRpc = {
    callEvent: (...args) => void called.push(args),
    register: (fn) => void (receive = fn.handler),
  };
  return {rpc, called, receive: (...args: unknown[]) => receive(...args)};
};

describe('createRpcTransport', () => {
  test('sends as page-send and receives page-receive by channel', () => {
    const {rpc, called, receive} = fakeRpc();
    const transport = createRpcTransport(rpc);
    const seen: unknown[] = [];
    const off = transport.on('lit:a', (d) => seen.push(d));
    transport.on('lit:b', () => seen.push('b'));

    transport.send('lit:x', {n: 1});
    receive('lit:a', 1);
    receive('lit:c', 'nobody listens');
    off();
    receive('lit:a', 2);

    expect(called).toEqual([['page-send', 'lit:x', {n: 1}]]);
    expect(seen).toEqual([1]);
  });
});
