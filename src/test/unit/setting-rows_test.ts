import {describe, expect, test} from 'vite-plus/test';
import {resolveOptions, toFeatureSettings} from '../../lib/options.js';
import type {LitPluginOptions} from '../../lib/options.js';
import {settingRow, type SettingRowContext} from '../../panel/setting-rows.js';
import type {
  OverrideBaselines,
  SettingsOverride,
} from '../../types/timeline.js';

const context = (
  options: LitPluginOptions = {},
  env: Record<string, string> = {},
  override: SettingsOverride = {},
  recorded: OverrideBaselines = {}
): SettingRowContext => ({
  config: toFeatureSettings(resolveOptions(options, env)),
  override,
  recorded,
});

describe('a config Setting', () => {
  test('shows its config value and where it came from', () => {
    const row = settingRow(
      'hmrReconnect',
      context({}, {LIT_PLUGIN_HMR_RECONNECT: 'true'})
    );
    expect(row).toMatchObject({
      label: 'reconnect',
      value: true,
      text: 'on',
      origin: 'env',
      disabled: false,
    });
    expect(row.override).toBeUndefined();
  });

  test('a built-in default reports its origin as default', () => {
    expect(settingRow('hmrReconnect', context()).origin).toBe('default');
  });

  test('a read-only Setting formats its value', () => {
    const row = settingRow(
      'sourceOverlayKey',
      context({sourceOverlay: {key: 'k'}})
    );
    expect(row).toMatchObject({text: 'Ctrl+Shift+K', origin: 'option'});
  });
});

describe('an overridden Setting', () => {
  test('shows the override and names the baseline it replaced', () => {
    const row = settingRow(
      'hmrReconnect',
      context({}, {LIT_PLUGIN_HMR_RECONNECT: 'false'}, {hmrReconnect: true})
    );
    expect(row).toMatchObject({value: true, text: 'on'});
    expect(row.override).toEqual({source: 'env', baseline: 'off'});
  });

  test('points out a baseline that moved since, formatted like the row', () => {
    const moved = settingRow(
      'hmrIndicatorVisible',
      context(
        {},
        {},
        {hmrIndicatorVisible: false},
        {hmrIndicatorVisible: false}
      )
    );
    // The config says shown (the default); the override was made when it
    // said hidden.
    expect(moved.override?.moved).toEqual({was: 'hidden', now: 'shown'});

    const same = settingRow(
      'hmrIndicatorVisible',
      context({}, {}, {hmrIndicatorVisible: false}, {hmrIndicatorVisible: true})
    );
    expect(same.override?.moved).toBeUndefined();

    // An override from before baselines were recorded never nudges.
    const legacy = settingRow(
      'hmrIndicatorVisible',
      context({}, {}, {hmrIndicatorVisible: false})
    );
    expect(legacy.override?.moved).toBeUndefined();
  });

  test('a custom editor is never reported as moved', () => {
    const row = settingRow(
      'sourceOverlayEditor',
      context(
        {sourceOverlay: {editor: {open: () => {}} as never}},
        {},
        {sourceOverlayEditor: 'zed'},
        {sourceOverlayEditor: 'cursor'}
      )
    );
    expect(row.override).toMatchObject({source: 'option', baseline: 'Custom'});
    expect(row.override?.moved).toBeUndefined();
  });
});

describe('a select', () => {
  test('marks the config value with its origin and the built-in default', () => {
    const row = settingRow(
      'hmrOnIncompatible',
      context({}, {LIT_PLUGIN_HMR_ON_INCOMPATIBLE: 'warn'})
    );
    expect(row.options).toEqual([
      {value: 'reload', text: 'reload', marker: 'default'},
      {value: 'warn', text: 'warn', marker: 'env'},
    ]);
  });

  test('marks only the default when the config is the default', () => {
    const row = settingRow('hmrChildState', context());
    expect(row.options?.map((o) => [o.value, o.marker])).toEqual([
      ['transfer', 'default'],
      ['reuse', undefined],
      ['reset', undefined],
    ]);
  });

  test('offers the built-in editors by name', () => {
    const row = settingRow(
      'sourceOverlayEditor',
      context({sourceOverlay: true})
    );
    expect(row.options?.[0]).toEqual({
      value: 'vscode',
      text: 'VS Code',
      marker: 'default',
    });
    expect(row.text).toBe('VS Code');
  });
});

describe('a preference', () => {
  test('reads its default when unset and has no origin or baseline', () => {
    const row = settingRow('chromeTracks', {
      config: null,
      override: {},
      recorded: {},
    });
    expect(row).toMatchObject({value: false, text: 'off'});
    expect(row.origin).toBeUndefined();

    const on = settingRow(
      'chromeTracks',
      context({}, {}, {chromeTracks: true})
    );
    expect(on).toMatchObject({value: true, text: 'on'});
    expect(on.override).toBeUndefined();
  });
});

describe('a disabled row', () => {
  test('the indicator rows lock while the config has the indicator off', () => {
    const off = context({hmr: {indicator: false}});
    expect(settingRow('hmrIndicatorVisible', off)).toMatchObject({
      disabled: true,
      text: 'off (config)',
    });
    expect(settingRow('hmrIndicatorCount', off)).toMatchObject({
      disabled: true,
      text: 'hidden',
    });
    expect(settingRow('hmrIndicatorVisible', context()).disabled).toBe(false);
  });

  test('colour by frequency waits for flash updates', () => {
    expect(settingRow('flashUpdatesRamp', context()).disabled).toBe(true);
    expect(
      settingRow('flashUpdatesRamp', context({}, {}, {flashUpdates: true}))
        .disabled
    ).toBe(false);
  });

  test("chrome tracks lock where the page's browser ignores them", () => {
    const on = {chromeTracks: true};
    expect(
      settingRow('chromeTracks', {...context({}, {}, on), chromeTracks: false})
    ).toMatchObject({disabled: true, text: 'needs Chrome 134+'});
    // Unknown until a runtime reports, and an older runtime never does.
    expect(settingRow('chromeTracks', context({}, {}, on)).disabled).toBe(
      false
    );
  });
});
