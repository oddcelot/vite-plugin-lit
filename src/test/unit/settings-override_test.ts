import {beforeEach, expect, test, vi} from 'vite-plus/test';
import {
  OVERRIDE_BASELINES_LS_KEY,
  SETTINGS_OVERRIDE_LS_KEY,
} from '../../types/timeline.js';

// The panel's RPC client has no injection seam, so this one import is replaced.
// What is under test is only the panel's port wiring; the module's behaviour
// is covered with fake ports in settings-overrides-module_test.ts.
const rpc = vi.hoisted(() => ({
  call: undefined as unknown as (...args: unknown[]) => unknown,
  set: undefined as unknown as (...args: unknown[]) => unknown,
  del: undefined as unknown as (...args: unknown[]) => unknown,
}));

vi.mock('../../panel/client.js', () => ({
  litRpc: async () => ({
    rpc: {call: (...a: unknown[]) => rpc.call(...a)},
    settings: {
      global: {
        set: (...a: unknown[]) => rpc.set(...a),
        delete: (...a: unknown[]) => rpc.del(...a),
      },
    },
  }),
}));

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let data: Map<string, string>;
let mod: typeof import('../../panel/settings-override.js');

beforeEach(async () => {
  vi.unstubAllGlobals();
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  rpc.call = vi.fn(async () => undefined);
  rpc.set = vi.fn(async () => undefined);
  rpc.del = vi.fn(async () => undefined);
  vi.resetModules();
  mod = await import('../../panel/settings-override.js');
});

test('a change reaches localStorage, the durable store and the live page', async () => {
  mod.overrides.set('hmrReconnect', false);
  await flush();
  expect(JSON.parse(data.get(SETTINGS_OVERRIDE_LS_KEY)!)).toEqual({
    hmrReconnect: false,
  });
  expect(rpc.set).toHaveBeenCalledWith('override', {hmrReconnect: false});
  expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {
    hmrReconnect: false,
  });
});

test('reset deletes both durable copies', async () => {
  data.set(OVERRIDE_BASELINES_LS_KEY, '{"hmrReconnect":true}');
  mod.overrides.reset();
  await flush();
  expect(rpc.del).toHaveBeenCalledWith('override');
  expect(rpc.del).toHaveBeenCalledWith('overrideBaselines');
  expect(data.size).toBe(0);
});

test('RPC failures are swallowed', async () => {
  rpc.set = vi.fn(async () => {
    throw new Error('offline');
  });
  rpc.call = vi.fn(async () => {
    throw new Error('offline');
  });
  const listener = vi.fn();
  mod.overrides.subscribe(listener);
  expect(() => mod.overrides.set('hmrReconnect', false)).not.toThrow();
  await flush();
  expect(listener).toHaveBeenCalledWith({hmrReconnect: false});
});
