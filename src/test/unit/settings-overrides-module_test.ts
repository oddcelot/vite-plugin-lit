import {describe, expect, test, vi} from 'vite-plus/test';
import {
  CONFIG_KEYS,
  PREFERENCE_DEFAULTS,
  configValues,
  createSettingsOverrides,
  preferences,
  type DurablePort,
  type LivePort,
} from '../../lib/settings-override.js';
import {
  OVERRIDE_BASELINES_LS_KEY,
  SETTINGS_OVERRIDE_LS_KEY,
  type FeatureSettings,
  type SettingsOverride,
} from '../../types/timeline.js';

const config = {
  hmr: {
    enabled: true,
    reconnect: true,
    onIncompatible: 'reload',
    childState: 'reset',
    indicatorEnabled: true,
    indicatorCount: false,
  },
  sourceOverlay: {enabled: true, key: 'o', editor: 'zed', throttleMs: 0},
  timeline: true,
} satisfies FeatureSettings as FeatureSettings;

/** Fake ports that record every call, with a durable store that echoes back. */
const setup = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  const pushed: SettingsOverride[] = [];
  let inbound: ((o: SettingsOverride) => void) | undefined;
  const live: LivePort = {
    push: (o) => void pushed.push(o),
    listen: (cb) => void (inbound = cb),
  };
  const store = new Map<string, unknown>();
  const durable: DurablePort = {
    set: (k: string, v: unknown) => void store.set(k, v),
    delete: (k) => void store.delete(k),
  } as DurablePort;
  const overrides = createSettingsOverrides({storage, live, durable});
  const stored = (key: string) => {
    const raw = data.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  };
  return {
    data,
    pushed,
    store,
    overrides,
    stored,
    inbound: (o: SettingsOverride) => inbound?.(o),
  };
};

describe('reading', () => {
  test('empty when nothing is stored', () => {
    const {overrides} = setup();
    expect(overrides.get()).toEqual({});
    expect(overrides.baselines()).toEqual({});
  });

  test('parses stored JSON', () => {
    const {overrides} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]: '{"hmrReconnect":false}',
      [OVERRIDE_BASELINES_LS_KEY]: '{"hmrReconnect":true}',
    });
    expect(overrides.get()).toEqual({hmrReconnect: false});
    expect(overrides.baselines()).toEqual({hmrReconnect: true});
  });

  test('malformed JSON and throwing storage fall back to empty', () => {
    expect(
      setup({[SETTINGS_OVERRIDE_LS_KEY]: '{oops'}).overrides.get()
    ).toEqual({});
    const throwing = createSettingsOverrides({
      storage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('full');
        },
        removeItem: () => {
          throw new Error('full');
        },
      },
    });
    expect(throwing.get()).toEqual({});
    expect(() => throwing.set('hmrReconnect', false)).not.toThrow();
  });
});

describe('set', () => {
  test('writes local, durable and live copies and notifies', () => {
    const {overrides, stored, store, pushed} = setup();
    const cb = vi.fn();
    overrides.subscribe(cb);
    overrides.set('hmrReconnect', false);
    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({hmrReconnect: false});
    expect(store.get('override')).toEqual({hmrReconnect: false});
    expect(pushed).toEqual([{hmrReconnect: false}]);
    expect(cb).toHaveBeenCalledWith({hmrReconnect: false});
  });

  test('merges over the existing override', () => {
    const {overrides, stored} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]: '{"hmrChildState":"reuse"}',
    });
    overrides.set('hmrReconnect', false);
    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({
      hmrChildState: 'reuse',
      hmrReconnect: false,
    });
  });

  test('records the config baseline for a mapped key, never sending it live', () => {
    const {overrides, stored, store, pushed} = setup();
    overrides.set('sourceOverlayEditor', 'vscode', config);
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({
      sourceOverlayEditor: 'zed',
    });
    expect(store.get('overrideBaselines')).toEqual({
      sourceOverlayEditor: 'zed',
    });
    expect(pushed[0]).toEqual({sourceOverlayEditor: 'vscode'});
  });

  test('a preference has no baseline', () => {
    const {overrides, stored} = setup();
    overrides.set('flashUpdates', true, config);
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toBeUndefined();
  });

  test('no baseline without a config', () => {
    const {overrides, stored} = setup();
    overrides.set('hmrReconnect', false);
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toBeUndefined();
  });
});

describe('reset', () => {
  const seeded = {
    [SETTINGS_OVERRIDE_LS_KEY]: '{"hmrReconnect":false}',
    [OVERRIDE_BASELINES_LS_KEY]: '{"hmrReconnect":true}',
  };

  test('clears everything and notifies with an empty override', () => {
    const {overrides, data, store, pushed} = setup(seeded);
    const cb = vi.fn();
    overrides.subscribe(cb);
    overrides.reset();
    expect(data.size).toBe(0);
    expect(store.has('override') || store.has('overrideBaselines')).toBe(false);
    expect(pushed).toEqual([]);
    expect(cb).toHaveBeenCalledWith({});
  });

  test('with a config, pushes the env values and preference defaults live', () => {
    const {overrides, pushed} = setup(seeded);
    overrides.reset(config);
    expect(pushed).toEqual([{...configValues(config), ...PREFERENCE_DEFAULTS}]);
    expect(pushed[0]).toMatchObject({
      hmrReconnect: true,
      sourceOverlayEditor: 'zed',
      flashUpdates: false,
      chromeTracks: false,
    });
  });
});

describe('resetKey', () => {
  test('drops one key and pushes its config value alongside the rest', () => {
    const {overrides, stored, pushed} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]:
        '{"hmrReconnect":false,"hmrChildState":"reuse"}',
      [OVERRIDE_BASELINES_LS_KEY]:
        '{"hmrReconnect":true,"hmrChildState":"reset"}',
    });
    const cb = vi.fn();
    overrides.subscribe(cb);
    overrides.resetKey('hmrReconnect', config);
    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({hmrChildState: 'reuse'});
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({hmrChildState: 'reset'});
    expect(pushed).toEqual([{hmrChildState: 'reuse', hmrReconnect: true}]);
    expect(cb).toHaveBeenCalledWith({hmrChildState: 'reuse'});
  });

  test('dropping the last key deletes the stored copies', () => {
    const {overrides, data, store} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]: '{"hmrReconnect":false}',
      [OVERRIDE_BASELINES_LS_KEY]: '{"hmrReconnect":true}',
    });
    overrides.resetKey('hmrReconnect', config);
    expect(data.size).toBe(0);
    expect(store.size).toBe(0);
  });
});

describe('keep', () => {
  test('re-stamps one baseline and notifies with the current override', () => {
    const {overrides, stored} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]: '{"sourceOverlayEditor":"vscode"}',
      [OVERRIDE_BASELINES_LS_KEY]:
        '{"sourceOverlayEditor":"cursor","hmrReconnect":false}',
    });
    const cb = vi.fn();
    overrides.subscribe(cb);
    overrides.keep('sourceOverlayEditor', config);
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({
      sourceOverlayEditor: 'zed',
      hmrReconnect: false,
    });
    expect(cb).toHaveBeenCalledWith({sourceOverlayEditor: 'vscode'});
  });
});

describe('adopt (the hydrate loop guard)', () => {
  test('mirrors local and live, notifies, and never writes back to the durable store', () => {
    const {overrides, stored, store, pushed} = setup();
    const cb = vi.fn();
    overrides.subscribe(cb);
    const applied = overrides.adopt({
      override: {hmrReconnect: false},
      overrideBaselines: {hmrReconnect: true},
    });
    expect(applied).toBe(true);
    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({hmrReconnect: false});
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({hmrReconnect: true});
    expect(pushed).toEqual([{hmrReconnect: false}]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  test('an identical snapshot is a no-op', () => {
    const {overrides, pushed} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]: '{"hmrReconnect":false}',
      [OVERRIDE_BASELINES_LS_KEY]: '{"hmrReconnect":true}',
    });
    const cb = vi.fn();
    overrides.subscribe(cb);
    expect(
      overrides.adopt({
        override: {hmrReconnect: false},
        overrideBaselines: {hmrReconnect: true},
      })
    ).toBe(false);
    expect(pushed).toEqual([]);
    expect(cb).not.toHaveBeenCalled();
  });

  test('a snapshot without an override is ignored', () => {
    const {overrides, pushed} = setup();
    expect(overrides.adopt({})).toBe(false);
    expect(pushed).toEqual([]);
  });

  test('missing baselines count as empty, so an override-only snapshot matches an unbaselined store', () => {
    const {overrides} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]: '{"flashUpdates":true}',
    });
    expect(overrides.adopt({override: {flashUpdates: true}})).toBe(false);
  });

  test('a baselines-only difference still adopts', () => {
    const {overrides, stored} = setup({
      [SETTINGS_OVERRIDE_LS_KEY]: '{"hmrReconnect":false}',
    });
    expect(
      overrides.adopt({
        override: {hmrReconnect: false},
        overrideBaselines: {hmrReconnect: true},
      })
    ).toBe(true);
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({hmrReconnect: true});
  });

  test('echo loop terminates: a durable store that re-emits every write adopts once', () => {
    // Model the real wiring: a durable write comes back as onChange -> adopt.
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    const state: {
      override?: SettingsOverride;
      overrideBaselines?: Record<string, unknown>;
    } = {};
    let adoptions = 0;
    let echo = (): void => {};
    const durable = {
      set: (k: 'override' | 'overrideBaselines', v: never) => {
        state[k] = v;
        echo();
      },
      delete: (k: 'override' | 'overrideBaselines') => {
        delete state[k];
        echo();
      },
    } as DurablePort;
    const overrides = createSettingsOverrides({storage, durable});
    echo = () => {
      if (overrides.adopt(state)) adoptions++;
    };
    overrides.set('hmrReconnect', false, config);
    expect(adoptions).toBe(0);
    // A second browser's write arrives from the store.
    state.override = {hmrReconnect: true};
    state.overrideBaselines = {hmrReconnect: true};
    echo();
    echo();
    expect(adoptions).toBe(1);
    expect(overrides.get()).toEqual({hmrReconnect: true});
  });
});

describe('subscribe', () => {
  test('the returned function unsubscribes', () => {
    const {overrides} = setup();
    const cb = vi.fn();
    const off = overrides.subscribe(cb);
    overrides.set('hmrReconnect', false);
    off();
    overrides.set('hmrReconnect', true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('does not fire for external storage writes', () => {
    const {overrides, data} = setup();
    const cb = vi.fn();
    overrides.subscribe(cb);
    data.set(SETTINGS_OVERRIDE_LS_KEY, '{"hmrReconnect":false}');
    overrides.get();
    expect(cb).not.toHaveBeenCalled();
  });

  test('fires with what the live port delivers, without storing it', () => {
    const {overrides, inbound, data} = setup();
    const cb = vi.fn();
    overrides.subscribe(cb);
    inbound({flashUpdates: true});
    expect(cb).toHaveBeenCalledWith({flashUpdates: true});
    expect(data.size).toBe(0);
  });
});

test('every config key resolves a value from the config', () => {
  expect(Object.keys(configValues(config)).sort()).toEqual(
    Object.keys(CONFIG_KEYS).sort()
  );
});

test('preferences default to off', () => {
  expect(preferences({})).toEqual({
    flashUpdates: false,
    flashUpdatesRamp: false,
    chromeTracks: false,
  });
  expect(preferences({chromeTracks: true}).chromeTracks).toBe(true);
});
