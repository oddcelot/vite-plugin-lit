/**
 * Runs a devframe definition in the same JavaScript realm as its client, with
 * no server and no wire in between: the host for the Chrome DevTools
 * extension, which shows the Lit panel for pages no dev server is watching.
 *
 * devframe has no hook for this. Its client (`connectDevframe()`) only speaks
 * WebSocket, SSE or a static dump, and its host (`createHostContext()`) is
 * built on `node:` modules, so neither half runs in an extension page. What
 * runs fine is the definition itself (see `definition.ts`), and its `setup()`
 * touches a small slice of the node context. {@link createLocalHost}
 * implements exactly that slice and hands back a client whose calls go
 * straight to the registered handlers.
 *
 * Where devframe ships browser-safe pieces they are reused rather than
 * re-implemented: shared state (`devframe/utils/shared-state`), stream sinks
 * and readers (`devframe/utils/streaming-channel`) and the client's own
 * `lit:` scoping and settings stores (`createScopedClientContext()`), so the
 * panel sees the namespacing and settings semantics it gets from a real
 * connection. The remaining differences are deliberate:
 *
 * - Shared states are one object on both sides, not two mirrors. A mutation
 *   is visible to the other side at once, with no patch round trip.
 * - Call arguments, results, broadcasts and stream chunks are
 *   `structuredClone`d, so neither side can mutate (or be handed a frozen
 *   copy of) the other's objects. A wire would have copied them too.
 * - `settings` live in a {@link KeyValueStorage} the embedder supplies (the
 *   extension passes `chrome.storage`), not a JSON file.
 * - No services: `services.get()` answers `undefined`, which is how
 *   `open-source` learns there is no editor to open.
 */

import {createClientSettings, createScopedClientContext} from 'devframe/client';
import type {DevframeRpcClient} from 'devframe/client';
import {createSharedState} from 'devframe/utils/shared-state';
import type {SharedState} from 'devframe/utils/shared-state';
import {
  createStreamReader,
  createStreamSink,
} from 'devframe/utils/streaming-channel';
import type {StreamReader, StreamSink} from 'devframe/utils/streaming-channel';
import type {DevframeDefinition, DevframeNodeContext} from 'devframe';

/**
 * Durable storage for the settings stores. Each store is one entry, keyed by
 * its devframe shared-state key (`devframe:settings:global:lit`) and holding
 * the whole settings object, which maps directly onto `chrome.storage.local`.
 */
export interface KeyValueStorage {
  /** The stored value, or `undefined` when there is none. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** A {@link KeyValueStorage} that forgets everything with the page. */
export const createMemoryStorage = (): KeyValueStorage => {
  const entries = new Map<string, unknown>();
  return {
    get: async (key) => entries.get(key),
    set: async (key, value) => void entries.set(key, value),
  };
};

export interface LocalHostOptions {
  /** Where settings persist. Defaults to {@link createMemoryStorage}. */
  storage?: KeyValueStorage;
}

/**
 * The slice of devframe's {@link DevframeRpcClient} the local host provides:
 * what `createScopedClientContext()` and the panel reach for. The rest
 * (trust handshakes, the RPC cache, wire services) has nothing behind it.
 */
export type LocalDevframeClient = Pick<
  DevframeRpcClient,
  | 'isTrusted'
  | 'ensureTrusted'
  | 'call'
  | 'callEvent'
  | 'callOptional'
  | 'client'
  | 'sharedState'
  | 'streaming'
  | 'scope'
>;

/** A server function as `register()` receives it. */
interface FunctionDefinition {
  name: string;
  type?: string;
  handler?: (...args: any[]) => unknown;
  setup?: (context: any) => unknown;
}

/** A client function, the target of a broadcast. */
interface ClientFunction {
  name: string;
  handler?: (...args: any[]) => unknown;
}

/** `my-plugin` + `fn` → `my-plugin:fn`; an already qualified name is kept. */
const qualify = (namespace: string, name: string): string =>
  name.includes(':') ? name : `${namespace}:${name}`;

const SETTINGS_KEY_PREFIX = 'devframe:settings:';

const copy = <T>(value: T): T =>
  value === undefined ? value : structuredClone(value);

/**
 * Run `definition.setup()` against an in-process context and return a client
 * wired straight to it. Resolves once setup has finished, so the client's
 * first call already finds every function registered.
 */
export async function createLocalHost(
  definition: DevframeDefinition,
  options: LocalHostOptions = {}
): Promise<LocalDevframeClient> {
  const storage = options.storage ?? createMemoryStorage();

  // --- Server functions -----------------------------------------------------

  const functions = new Map<string, FunctionDefinition>();
  const resolved = new Map<string, Promise<(...args: any[]) => unknown>>();

  const register = (fn: FunctionDefinition, force = false): void => {
    if (functions.has(fn.name) && !force) {
      throw new Error(`[lit-devtools] ${fn.name} is already registered`);
    }
    functions.set(fn.name, fn);
    resolved.delete(fn.name);
  };

  const handlerOf = (name: string): Promise<(...args: any[]) => unknown> => {
    let handler = resolved.get(name);
    if (handler === undefined) {
      const fn = functions.get(name);
      if (fn === undefined) {
        return Promise.reject(new Error(`[lit-devtools] no function ${name}`));
      }
      handler = (async () => {
        if (fn.handler) return fn.handler;
        // devframe's lazy form: `setup(ctx)` returns the handler, once.
        const setup = (await fn.setup?.(context)) as
          | {handler?: (...args: any[]) => unknown}
          | undefined;
        if (setup?.handler === undefined) {
          throw new Error(`[lit-devtools] ${name} has no handler`);
        }
        return setup.handler;
      })();
      resolved.set(name, handler);
    }
    return handler;
  };

  const invoke = async (name: string, args: unknown[]): Promise<unknown> => {
    const handler = await handlerOf(name);
    return copy(await handler(...copy(args)));
  };

  // --- Client functions (broadcast targets) ---------------------------------

  const clientFunctions = new Map<string, ClientFunction>();

  const broadcast = async (options: {
    method: string;
    args: unknown[];
    optional?: boolean;
  }): Promise<void> => {
    const fn = clientFunctions.get(options.method);
    if (fn?.handler === undefined) {
      // No panel listening is normal for the optional pushes.
      if (options.optional) return;
      throw new Error(`[lit-devtools] no client function ${options.method}`);
    }
    // A broadcast reaches its listeners later, never inside the caller's
    // stack, as it would over a wire.
    await Promise.resolve();
    try {
      await fn.handler(...copy(options.args));
    } catch (error) {
      console.error(`[lit-devtools] ${options.method} handler threw`, error);
    }
  };

  // --- Shared state ---------------------------------------------------------

  const states = new Map<string, Promise<SharedState<any>>>();

  const sharedState = <T extends object>(
    key: string,
    options: {initialValue?: T; sharedState?: SharedState<T>} = {}
  ): Promise<SharedState<T>> => {
    let state = states.get(key);
    if (state === undefined) {
      state = (async () => {
        if (!key.startsWith(SETTINGS_KEY_PREFIX)) {
          return (
            options.sharedState ??
            createSharedState({initialValue: options.initialValue ?? ({} as T)})
          );
        }
        // A settings store: seeded from storage, written back on change.
        const stored = (await storage.get(key)) as T | undefined;
        const settings = createSharedState<T>({
          initialValue: {...options.initialValue, ...stored} as T,
        });
        settings.on('updated', (value) => {
          storage.set(key, copy(value)).catch((error: unknown) => {
            console.warn(`[lit-devtools] could not persist ${key}`, error);
          });
        });
        return settings;
      })();
      states.set(key, state);
    }
    return state;
  };

  const sharedStateHost = {
    get: sharedState,
    keys: () => [...states.keys()],
    onKeyAdded: () => () => {},
    delete: (key: string) => states.delete(key),
  };

  // --- Streaming ------------------------------------------------------------

  /** Readers by `<channel>\0<id>`, kept across restarts of the same id. */
  const readers = new Map<string, Set<StreamReader<unknown>>>();
  const readersOf = (channel: string, id: string) => {
    const key = `${channel}\0${id}`;
    let set = readers.get(key);
    if (set === undefined) readers.set(key, (set = new Set()));
    return set;
  };

  const createChannel = <T>(name: string) => {
    const sinks = new Map<string, StreamSink<T>>();
    const start = (opts: {id?: string} = {}): StreamSink<T> => {
      const sink = createStreamSink<T>({id: opts.id});
      sinks.set(sink.id, sink);
      sink.events.on('chunk', (seq, chunk) => {
        for (const reader of readersOf(name, sink.id)) {
          reader._push(seq, copy(chunk));
        }
      });
      sink.events.on('end', (error) => {
        if (sinks.get(sink.id) === sink) sinks.delete(sink.id);
        for (const reader of readersOf(name, sink.id)) reader._end(error);
      });
      return sink;
    };
    return {
      name,
      start,
      get: (id: string) => sinks.get(id),
      ids: () => [...sinks.keys()],
      async pipeFrom(readable: ReadableStream<T>, opts?: {id?: string}) {
        const sink = start(opts);
        void readable
          .pipeTo(sink.writable, {signal: sink.signal})
          .catch(() => {});
        return sink;
      },
      openInbound(): never {
        throw new Error('[lit-devtools] uploads are not supported locally');
      },
    };
  };

  const channels = new Set<string>();
  const streamingHost = {
    create<T>(name: string) {
      if (channels.has(name)) {
        throw new Error(`[lit-devtools] stream ${name} already exists`);
      }
      channels.add(name);
      return createChannel<T>(name);
    },
    _onSessionDisconnected: () => {},
  };

  // --- The node context -----------------------------------------------------

  /**
   * devframe's diagnostics print to the dev server's terminal. There is none
   * here, so a diagnostic is a `console.debug` line.
   */
  const diagnostics = {
    defineDiagnostics(definitions: {
      codes: Record<string, {why?: string | ((params: any) => string)}>;
    }) {
      const handles: Record<string, (params?: unknown) => void> = {};
      for (const [code, {why}] of Object.entries(definitions.codes)) {
        handles[code] = (params) =>
          console.debug(
            `[lit-devtools] ${code}`,
            typeof why === 'function' ? why(params) : (why ?? '')
          );
      }
      return handles;
    },
    register: () => {},
    logger: {},
  };

  const rpcHost = {
    register,
    update: (fn: FunctionDefinition) => register(fn, true),
    invokeLocal: (name: string, ...args: unknown[]) => invoke(name, args),
    broadcast,
    getCurrentRpcSession: () => undefined,
    sharedState: sharedStateHost,
    streaming: streamingHost,
    has: (name: string) => functions.has(name),
    list: () => [...functions.keys()],
  };

  const scopeOf = (namespace: string) => {
    const prefixed = <F extends FunctionDefinition>(fn: F): F => {
      if (fn.name.includes(':')) {
        throw new Error(
          `[lit-devtools] ${fn.name}: register a bare name in scope ${namespace}`
        );
      }
      return {...fn, name: `${namespace}:${fn.name}`};
    };
    return {
      namespace,
      base: context,
      mode: context.mode,
      cwd: context.cwd,
      workspaceRoot: context.workspaceRoot,
      diagnostics,
      rpc: {
        namespace,
        register: (fn: FunctionDefinition, force?: boolean) =>
          register(prefixed(fn), force),
        update: (fn: FunctionDefinition) => register(prefixed(fn), true),
        call: (name: string, ...args: unknown[]) =>
          invoke(qualify(namespace, name), args),
        broadcast: (options: {method: string; args: unknown[]}) =>
          broadcast({...options, method: qualify(namespace, options.method)}),
        sharedState: <T extends object>(
          key: string,
          options?: {initialValue?: T}
        ) => sharedState<T>(qualify(namespace, key), options),
        streaming: {
          create: <T>(name: string) =>
            streamingHost.create<T>(qualify(namespace, name)),
        },
        getCurrentRpcSession: () => undefined,
      },
      // devframe's client-side stores are plain key/value views over the
      // `devframe:settings:<scope>:<namespace>` shared state, which is all the
      // node side is too; here both sides resolve that state from the host.
      settings: createClientSettings(
        {sharedState: sharedStateHost} as unknown as DevframeRpcClient,
        namespace
      ),
      scope: (next?: string | null) => scope(next),
    };
  };

  const scope = (namespace?: string | null) =>
    namespace ? scopeOf(namespace) : context;

  // Cast once, here: this is the subset `setup()` is known to use (see
  // `definition.ts` and `rpc-source.ts`), not the full node context.
  const context = {
    mode: 'dev',
    cwd: '/',
    workspaceRoot: '/',
    rpc: rpcHost,
    diagnostics,
    services: {
      get: () => undefined,
      has: () => false,
    },
    staticConfig: {},
    scope,
  } as unknown as DevframeNodeContext;

  await definition.setup(context);

  // --- The client -----------------------------------------------------------

  const client = {
    isTrusted: true,
    ensureTrusted: async () => true,
    call: (name: string, ...args: unknown[]) => invoke(name, args),
    callEvent(name: string, ...args: unknown[]) {
      invoke(name, args).catch((error: unknown) => {
        console.error(`[lit-devtools] ${name} failed`, error);
      });
    },
    callOptional: (name: string, ...args: unknown[]) =>
      functions.has(name) ? invoke(name, args) : Promise.resolve(undefined),
    client: {
      register: (fn: ClientFunction) => void clientFunctions.set(fn.name, fn),
      update: (fn: ClientFunction) => void clientFunctions.set(fn.name, fn),
      has: (name: string) => clientFunctions.has(name),
    },
    sharedState: sharedStateHost,
    streaming: {
      subscribe<T>(
        channel: string,
        id: string,
        options: {highWaterMark?: number} = {}
      ): StreamReader<T> {
        const set = readersOf(channel, id);
        const reader = createStreamReader<T>({
          id,
          highWaterMark: options.highWaterMark,
          onCancel: () => set.delete(reader as StreamReader<unknown>),
        });
        set.add(reader as StreamReader<unknown>);
        return reader;
      },
      upload(): never {
        throw new Error('[lit-devtools] uploads are not supported locally');
      },
    },
    scope: (namespace?: string | null): unknown =>
      namespace
        ? // devframe's own scoping, so `lit:` naming and `settings` behave
          // exactly as over a connection. It only touches the members above.
          createScopedClientContext(
            client as unknown as DevframeRpcClient,
            namespace
          )
        : client,
  };

  return client as unknown as LocalDevframeClient;
}
