import {beforeEach, expect, test, vi} from 'vite-plus/test';
import {baselineChanged} from '../../lib/override-baselines.js';
import {
  OVERRIDE_BASELINES_LS_KEY,
  SETTINGS_OVERRIDE_LS_KEY,
} from '../../types/timeline.js';

const rpc = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
  call: vi.fn(),
}));

// The panel client dials a WebSocket; the persistence module only needs the
// three calls it makes on it.
vi.mock('../../panel/client.js', () => ({
  litRpc: async () => ({
    rpc: {call: rpc.call},
    settings: {global: {set: rpc.set, delete: rpc.delete}},
  }),
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const {
  adoptOverride,
  commitOverride,
  dropOverrideKey,
  keepBaseline,
  readBaselines,
  readOverride,
  resetOverride,
} = await import('../../panel/settings-override.js');

// The module's RPC writes are fire-and-forget promises; let them run.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

test('a changed value is reported, an equal one is not', () => {
  expect(baselineChanged('hmrReconnect', true, false)).toBe(true);
  expect(baselineChanged('hmrReconnect', true, true)).toBe(false);
  expect(baselineChanged('sourceOverlayEditor', 'zed', 'cursor')).toBe(true);
  expect(baselineChanged('hmrOnIncompatible', {a: 1}, {a: 1})).toBe(false);
});

test('a legacy override with no recorded baseline never nudges', () => {
  expect(baselineChanged('hmrReconnect', undefined, true)).toBe(false);
  expect(baselineChanged('hmrReconnect', true, undefined)).toBe(false);
});

test('a custom editor is not compared', () => {
  expect(baselineChanged('sourceOverlayEditor', 'zed', 'custom')).toBe(false);
  expect(baselineChanged('sourceOverlayEditor', 'custom', 'zed')).toBe(false);
});

test('commit stores baselines next to the override, not in it', async () => {
  commitOverride({hmrReconnect: false}, {hmrReconnect: true});
  expect(readOverride()).toEqual({hmrReconnect: false});
  expect(readBaselines()).toEqual({hmrReconnect: true});
  expect(JSON.parse(store.get(SETTINGS_OVERRIDE_LS_KEY)!)).toEqual({
    hmrReconnect: false,
  });
  await flush();
  expect(rpc.set).toHaveBeenCalledWith('override', {hmrReconnect: false});
  expect(rpc.set).toHaveBeenCalledWith('overrideBaselines', {
    hmrReconnect: true,
  });
  // The live push carries the override only.
  expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {
    hmrReconnect: false,
  });
});

test('a commit without baselines leaves the recorded ones alone', () => {
  commitOverride({hmrReconnect: false}, {hmrReconnect: true});
  commitOverride({hmrReconnect: false, flashUpdates: true});
  expect(readBaselines()).toEqual({hmrReconnect: true});
});

test('dropping a key drops its baseline and keeps the others', () => {
  commitOverride(
    {hmrReconnect: false, sourceOverlayEditor: 'cursor'},
    {hmrReconnect: true, sourceOverlayEditor: 'zed'}
  );
  dropOverrideKey('hmrReconnect', true);
  expect(readOverride()).toEqual({sourceOverlayEditor: 'cursor'});
  expect(readBaselines()).toEqual({sourceOverlayEditor: 'zed'});
});

test('reset clears baselines locally and durably', async () => {
  commitOverride({hmrReconnect: false}, {hmrReconnect: true});
  resetOverride();
  expect(readBaselines()).toEqual({});
  expect(store.has(OVERRIDE_BASELINES_LS_KEY)).toBe(false);
  await flush();
  expect(rpc.delete).toHaveBeenCalledWith('overrideBaselines');
});

test('adopting mirrors baselines locally without writing them back', async () => {
  adoptOverride({hmrReconnect: false}, {hmrReconnect: true});
  expect(readBaselines()).toEqual({hmrReconnect: true});
  await flush();
  expect(rpc.set).not.toHaveBeenCalled();
});

test('keep re-stamps one baseline', () => {
  commitOverride({hmrReconnect: false}, {hmrReconnect: true});
  keepBaseline('hmrReconnect', false);
  expect(readBaselines()).toEqual({hmrReconnect: false});
  expect(readOverride()).toEqual({hmrReconnect: false});
});
