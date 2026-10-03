import {expect, expectTypeOf, test} from 'vite-plus/test';
import {
  SETTINGS,
  baselineChanged,
  settingsOf,
  type SettingDefinition,
  type SettingKey,
} from '../../lib/setting-definitions.js';
import {CONFIG_KEYS, PREFERENCE_DEFAULTS} from '../../lib/settings-override.js';
import type {SettingSources, SettingsOverride} from '../../types/timeline.js';

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

test('the derived types keep each Setting value type', () => {
  expectTypeOf<SettingsOverride>().toEqualTypeOf<{
    hmrReconnect?: boolean;
    hmrOnIncompatible?: 'reload' | 'warn';
    hmrChildState?: 'transfer' | 'reuse' | 'reset';
    hmrIndicatorVisible?: boolean;
    hmrIndicatorCount?: boolean;
    sourceOverlayEditor?: string;
    flashUpdates?: boolean;
    flashUpdatesRamp?: boolean;
    chromeTracks?: boolean;
  }>();
  expectTypeOf<keyof SettingSources>().toEqualTypeOf<
    | 'hmr'
    | 'hmrReconnect'
    | 'hmrOnIncompatible'
    | 'hmrChildState'
    | 'hmrIndicatorVisible'
    | 'hmrIndicatorCount'
    | 'sourceOverlay'
    | 'sourceOverlayEditor'
    | 'sourceOverlayKey'
    | 'sourceOverlayThrottleMs'
    | 'timeline'
  >();
});

test('the key map and preference defaults are derived from the definitions', () => {
  expect(Object.keys(CONFIG_KEYS)).toEqual(settingsOf('override'));
  expect(PREFERENCE_DEFAULTS).toEqual({
    flashUpdates: false,
    flashUpdatesRamp: false,
    chromeTracks: false,
  });
});

test('every Setting with a config value names its env var and reads it back', () => {
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const definition: SettingDefinition = SETTINGS[key];
    const sourced = definition.role !== 'preference';
    expect(definition.env !== undefined, key).toBe(sourced);
    expect(definition.read !== undefined, key).toBe(sourced);
    if (definition.env) expect(definition.env).toMatch(/^LIT_PLUGIN_[A-Z_]+$/);
  }
});
