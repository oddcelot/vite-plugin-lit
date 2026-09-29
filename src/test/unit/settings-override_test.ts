/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {beforeEach, describe, expect, test, vi} from 'vite-plus/test';
import {
  OVERRIDE_BASELINES_LS_KEY,
  SETTINGS_OVERRIDE_LS_KEY,
} from '../../types/timeline.js';

// The panel's RPC client has no injection seam, so this one import is replaced.
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

const fakeLocalStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let storage: ReturnType<typeof fakeLocalStorage>;
let mod: typeof import('../../panel/settings-override.js');

// Loosely typed on purpose: the tests exercise arbitrary override shapes.
const override = (value: unknown) => value as never;

beforeEach(async () => {
  vi.unstubAllGlobals();
  storage = fakeLocalStorage();
  vi.stubGlobal('localStorage', storage);
  rpc.call = vi.fn(async () => undefined);
  rpc.set = vi.fn(async () => undefined);
  rpc.del = vi.fn(async () => undefined);
  vi.resetModules();
  mod = await import('../../panel/settings-override.js');
});

const stored = (key: string) => {
  const raw = storage.data.get(key);
  return raw === undefined ? undefined : JSON.parse(raw);
};

describe('reading', () => {
  test('readOverride is empty when nothing is stored', () => {
    expect(mod.readOverride()).toEqual({});
  });

  test('readOverride parses the stored JSON', () => {
    storage.data.set(SETTINGS_OVERRIDE_LS_KEY, '{"a":1}');
    expect(mod.readOverride()).toEqual({a: 1});
  });

  test('readOverride falls back to empty on malformed JSON', () => {
    storage.data.set(SETTINGS_OVERRIDE_LS_KEY, '{oops');
    expect(mod.readOverride()).toEqual({});
  });

  test('readOverride falls back to empty when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(mod.readOverride()).toEqual({});
  });

  test('readBaselines is empty when unset or malformed', () => {
    expect(mod.readBaselines()).toEqual({});
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, 'nope');
    expect(mod.readBaselines()).toEqual({});
  });

  test('readBaselines parses the stored JSON', () => {
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"x":true}');
    expect(mod.readBaselines()).toEqual({x: true});
  });
});

describe('commitOverride', () => {
  test('writes local, durable and live copies and notifies', async () => {
    const listener = vi.fn();
    mod.onOverrideChange(listener);
    mod.commitOverride(override({a: 1}));
    await flush();

    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({a: 1});
    expect(rpc.set).toHaveBeenCalledWith('override', {a: 1});
    expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {a: 1});
    expect(listener).toHaveBeenCalledWith({a: 1});
  });

  test('leaves baselines alone when none are given', async () => {
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"x":1}');
    mod.commitOverride(override({a: 1}));
    await flush();
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({x: 1});
    expect(rpc.set).not.toHaveBeenCalledWith(
      'overrideBaselines',
      expect.anything()
    );
  });

  test('replaces baselines locally and durably when given, but never sends them live', async () => {
    mod.commitOverride(override({a: 1}), override({a: 0}));
    await flush();
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({a: 0});
    expect(rpc.set).toHaveBeenCalledWith('overrideBaselines', {a: 0});
    expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {a: 1});
  });

  test('empty baselines delete the stored copies', async () => {
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"x":1}');
    mod.commitOverride(override({a: 1}), override({}));
    await flush();
    expect(storage.data.has(OVERRIDE_BASELINES_LS_KEY)).toBe(false);
    expect(rpc.del).toHaveBeenCalledWith('overrideBaselines');
  });

  test('swallows storage and RPC failures', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
    });
    rpc.set = vi.fn(async () => {
      throw new Error('offline');
    });
    rpc.call = vi.fn(async () => {
      throw new Error('offline');
    });
    const listener = vi.fn();
    mod.onOverrideChange(listener);
    expect(() => mod.commitOverride(override({a: 1}))).not.toThrow();
    await flush();
    expect(listener).toHaveBeenCalledWith({a: 1});
  });
});

describe('patchOverride', () => {
  test('merges the patch over the stored override', async () => {
    storage.data.set(SETTINGS_OVERRIDE_LS_KEY, '{"a":1,"b":2}');
    mod.patchOverride(override({b: 3, c: 4}));
    await flush();
    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({a: 1, b: 3, c: 4});
    expect(rpc.set).toHaveBeenCalledWith('override', {a: 1, b: 3, c: 4});
  });

  test('starts from empty when nothing is stored', () => {
    mod.patchOverride(override({a: 1}));
    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({a: 1});
  });
});

describe('adoptOverride', () => {
  test('mirrors locally and live without writing back to the durable store', async () => {
    const listener = vi.fn();
    mod.onOverrideChange(listener);
    mod.adoptOverride(override({a: 1}), override({a: 0}));
    await flush();
    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({a: 1});
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({a: 0});
    expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {a: 1});
    expect(rpc.set).not.toHaveBeenCalled();
    expect(rpc.del).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith({a: 1});
  });

  test('keeps existing baselines when none are given', () => {
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"x":1}');
    mod.adoptOverride(override({a: 1}));
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({x: 1});
  });
});

describe('resetOverride', () => {
  test('clears local and durable copies and notifies with an empty override', async () => {
    storage.data.set(SETTINGS_OVERRIDE_LS_KEY, '{"a":1}');
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"a":0}');
    const listener = vi.fn();
    mod.onOverrideChange(listener);
    mod.resetOverride();
    await flush();
    expect(storage.data.size).toBe(0);
    expect(rpc.del).toHaveBeenCalledWith('override');
    expect(rpc.del).toHaveBeenCalledWith('overrideBaselines');
    expect(rpc.call).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith({});
  });

  test('pushes the resolved config live when given', async () => {
    mod.resetOverride(override({a: 9}));
    await flush();
    expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {a: 9});
  });
});

describe('dropOverrideKey', () => {
  test('removes one key, keeps the rest and pushes the baseline live', async () => {
    storage.data.set(SETTINGS_OVERRIDE_LS_KEY, '{"a":1,"b":2}');
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"a":0,"b":0}');
    const listener = vi.fn();
    mod.onOverrideChange(listener);
    mod.dropOverrideKey(override('a'), override(100));
    await flush();

    expect(stored(SETTINGS_OVERRIDE_LS_KEY)).toEqual({b: 2});
    expect(rpc.set).toHaveBeenCalledWith('override', {b: 2});
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({b: 0});
    expect(rpc.set).toHaveBeenCalledWith('overrideBaselines', {b: 0});
    expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {
      b: 2,
      a: 100,
    });
    expect(listener).toHaveBeenCalledWith({b: 2});
  });

  test('dropping the last key deletes the stored override', async () => {
    storage.data.set(SETTINGS_OVERRIDE_LS_KEY, '{"a":1}');
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"a":0}');
    mod.dropOverrideKey(override('a'), override(100));
    await flush();
    expect(storage.data.size).toBe(0);
    expect(rpc.del).toHaveBeenCalledWith('override');
    expect(rpc.del).toHaveBeenCalledWith('overrideBaselines');
    expect(rpc.call).toHaveBeenCalledWith('set-settings-override', {a: 100});
  });
});

describe('keepBaseline', () => {
  test('re-stamps one baseline and notifies with the current override', async () => {
    storage.data.set(SETTINGS_OVERRIDE_LS_KEY, '{"a":1}');
    storage.data.set(OVERRIDE_BASELINES_LS_KEY, '{"a":0,"b":5}');
    const listener = vi.fn();
    mod.onOverrideChange(listener);
    mod.keepBaseline(override('a'), 7);
    await flush();
    expect(stored(OVERRIDE_BASELINES_LS_KEY)).toEqual({a: 7, b: 5});
    expect(rpc.set).toHaveBeenCalledWith('overrideBaselines', {a: 7, b: 5});
    expect(listener).toHaveBeenCalledWith({a: 1});
  });
});

describe('onOverrideChange', () => {
  test('the returned function unsubscribes', () => {
    const listener = vi.fn();
    const off = mod.onOverrideChange(listener);
    mod.commitOverride(override({a: 1}));
    off();
    mod.commitOverride(override({a: 2}));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('does not fire for external localStorage writes', () => {
    const listener = vi.fn();
    mod.onOverrideChange(listener);
    storage.setItem(SETTINGS_OVERRIDE_LS_KEY, '{"a":1}');
    mod.readOverride();
    expect(listener).not.toHaveBeenCalled();
  });
});
