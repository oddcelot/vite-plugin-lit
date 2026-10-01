/**
 * Stand-in for `src/panel/client.ts`: a devframe client with no server.
 * Mock the real module with it:
 *
 *   vi.mock('../../panel/client.js', () => import('./fakes/client.js'));
 *
 * Calls are recorded in {@link calls} and answered from {@link answers};
 * shared states are plain values the test can update with
 * {@link updateSharedState}.
 */
import type {TimelineLayer} from '../../../types/timeline.js';

type Listener = (value: unknown) => void;

/** Every `rpc.call(name, ...args)`, in order. */
export const calls: Array<{name: string; args: unknown[]}> = [];
/** Replies for `rpc.call`, by name; a function gets the call's args. */
export const answers = new Map<string, unknown>();

/** Handlers the panel registered with `rpc.register`, by name. */
export const registered = new Map<string, (...args: unknown[]) => unknown>();

/** Test control: deliver a server push to whatever the panel registered. */
export const push = (name: string, ...args: unknown[]): void => {
  registered.get(name)?.(...args);
};

const states = new Map<string, {value: unknown; listeners: Set<Listener>}>();
const stateOf = (key: string) => {
  let state = states.get(key);
  if (state === undefined) {
    state = {value: undefined, listeners: new Set()};
    states.set(key, state);
  }
  return state;
};

/** Test control: set a shared state and fire its `updated` listeners. */
export const updateSharedState = (key: string, value: unknown): void => {
  const state = stateOf(key);
  state.value = value;
  for (const listener of state.listeners) listener(value);
};

const sharedStateOf = (key: string) => {
  const state = stateOf(key);
  return {
    value: () => state.value,
    on(event: string, listener: Listener) {
      if (event !== 'updated') return () => {};
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  };
};

const client = {
  /** The hub-wide client; the panel reads the dock activation slot here. */
  base: {
    sharedState: {get: async (key: string) => sharedStateOf(key)},
  },
  rpc: {
    async call(name: string, ...args: unknown[]): Promise<unknown> {
      calls.push({name, args});
      const answer = answers.get(name);
      return typeof answer === 'function'
        ? (answer as (...a: unknown[]) => unknown)(...args)
        : answer;
    },
    sharedState: async (key: string) => sharedStateOf(key),
    register(fn: {name: string; handler: (...args: unknown[]) => unknown}) {
      registered.set(fn.name, fn.handler);
    },
  },
};

export type LitClient = typeof client;

let snapshot = false;
/** Test control: pretend to be a frozen snapshot. */
export const setSnapshot = (next: boolean): void => {
  snapshot = next;
};
export const meta: {layers: TimelineLayer[]; features: unknown} = {
  layers: [],
  features: null,
};

export const litRpc = async () => client;
export const litSettingsRpc = async () => client;
export const isSnapshot = (): boolean => snapshot;
export const getMeta = async () => ({...meta});
export const describeError = (error: unknown): string => String(error);

/** Test control: forget calls, answers, states and meta. */
export const resetClient = (): void => {
  calls.length = 0;
  answers.clear();
  registered.clear();
  states.clear();
  meta.layers = [];
  meta.features = null;
  snapshot = false;
};
