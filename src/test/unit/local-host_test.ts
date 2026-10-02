import {describe, expect, test, vi} from 'vite-plus/test';
import {defineDevframe, defineRpcFunction} from 'devframe';
import type {DevframeNodeContext} from 'devframe';
import {
  createLocalHost,
  createMemoryStorage,
} from '../../lib/devframe/local-host.js';

// The in-process host against a tiny definition, one behaviour per test. The
// Lit definition over a real page runtime is covered in
// `dom/local-host_test.ts`.

/** Runs `setup` as a definition's setup and returns the host's client. */
const host = async (
  setup: (ctx: DevframeNodeContext) => void | Promise<void>,
  storage = createMemoryStorage()
) => {
  let context!: DevframeNodeContext;
  const client = await createLocalHost(
    defineDevframe({
      id: 'demo',
      name: 'Demo',
      version: '0.0.0',
      packageName: 'demo',
      description: 'A test devframe.',
      homepage: 'https://example.com/',
      async setup(ctx) {
        context = ctx;
        await setup(ctx);
      },
    }),
    {storage}
  );
  return {client, ctx: context, storage};
};

describe('createLocalHost', () => {
  test('routes a scoped call to the function registered in that scope', async () => {
    const {client} = await host((ctx) => {
      ctx.scope('demo').rpc.register(
        defineRpcFunction({
          name: 'echo',
          type: 'query',
          handler: async (value: {n: number}) => ({got: value.n}),
        })
      );
    });
    expect(await client.scope('demo').rpc.call('echo', {n: 1})).toEqual({
      got: 1,
    });
    // Namespaced on the wire, as devframe does it.
    const unscoped = client.call as (
      name: string,
      ...args: unknown[]
    ) => unknown;
    expect(await unscoped('demo:echo', {n: 2})).toEqual({got: 2});
    await expect(client.scope('demo').rpc.call('missing')).rejects.toThrow(
      /no function demo:missing/
    );
  });

  test('copies arguments and results across the boundary', async () => {
    const kept: Array<{list: number[]}> = [];
    const {client} = await host((ctx) => {
      ctx.scope('demo').rpc.register(
        defineRpcFunction({
          name: 'keep',
          type: 'action',
          handler: async (value: {list: number[]}) => {
            kept.push(value);
            return value;
          },
        })
      );
    });
    const sent = {list: [1]};
    const back = await client.scope('demo').rpc.call('keep', sent);
    sent.list.push(2);
    back.list.push(3);
    expect(kept[0]).toEqual({list: [1]});
  });

  test('broadcasts reach client functions; optional ones may have none', async () => {
    const {client, ctx} = await host(() => {});
    await expect(
      ctx.rpc.broadcast({
        method: 'demo:ping' as never,
        args: [1] as never,
        optional: true,
      })
    ).resolves.toBeUndefined();
    await expect(
      ctx.rpc.broadcast({method: 'demo:ping' as never, args: [1] as never})
    ).rejects.toThrow(/no client function demo:ping/);

    const handler = vi.fn();
    client.scope('demo').rpc.register({name: 'ping', type: 'event', handler});
    await ctx.scope('demo').rpc.broadcast({method: 'ping', args: [7]});
    expect(handler).toHaveBeenCalledWith(7);
  });

  test('shares one shared-state instance between host and client', async () => {
    let hostState: unknown;
    const {client} = await host(async (ctx) => {
      hostState = await ctx
        .scope('demo')
        .rpc.sharedState('session', {initialValue: {count: 0}});
    });
    const clientState = await client
      .scope('demo')
      .rpc.sharedState<{count: number}>('session');
    expect(clientState).toBe(hostState);
    clientState.mutate((draft) => {
      draft.count = 1;
    });
    expect((hostState as typeof clientState).value().count).toBe(1);
  });

  test('backs settings with the storage and mirrors them into shared state', async () => {
    const storage = createMemoryStorage();
    await storage.set('devframe:settings:global:demo', {theme: 'dark'});
    let seen: unknown;
    const {client} = await host(async (ctx) => {
      seen = await ctx.scope('demo').settings.global.get('theme');
    }, storage);
    expect(seen).toBe('dark');

    const scoped = client.scope('demo');
    await scoped.settings.global.set('density', 'compact');
    expect(await storage.get('devframe:settings:global:demo')).toEqual({
      theme: 'dark',
      density: 'compact',
    });
    // The key the panel's settings gate reads.
    const mirror = await client.sharedState.get<Record<string, unknown>>(
      'devframe:settings:global:demo'
    );
    expect(mirror.value()).toEqual({theme: 'dark', density: 'compact'});
  });

  test('delivers stream writes to subscribers', async () => {
    let write!: (chunk: number[]) => void;
    const {client} = await host((ctx) => {
      const channel = ctx.scope('demo').rpc.streaming.create<number[]>('feed');
      const sink = channel.start({id: 'main'});
      write = (chunk) => sink.write(chunk);
    });
    const reader = client
      .scope('demo')
      .rpc.streaming.subscribe<number[]>('feed', 'main');
    write([1, 2]);
    const iterator = reader[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual([1, 2]);
    reader.cancel();
  });

  test('has no services and no terminal for diagnostics', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await host((ctx) => {
      expect(ctx.services.get('@devframes/service-open')).toBeUndefined();
      const diagnostics = ctx.diagnostics.defineDiagnostics({
        docsBase: 'https://example.com/',
        codes: {DEMO_CODE: {why: (p: {n: number}) => `n is ${p.n}`}},
      });
      ctx.diagnostics.register(diagnostics);
      diagnostics.DEMO_CODE({n: 3});
    });
    expect(debug).toHaveBeenCalledWith('[lit-devtools] DEMO_CODE', 'n is 3');
    debug.mockRestore();
  });
});
