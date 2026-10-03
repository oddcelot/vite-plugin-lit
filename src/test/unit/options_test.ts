import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {toFeatureSettings} from '../../lib/options.js';
import {resolveOptions, type LitPluginOptions} from '../../lib/plugin.js';

/**
 * `resolveOptions` is the one place explicit options, `LIT_PLUGIN_*` env vars,
 * and defaults meet. The e2e builds cover what each `cssSheetBuild` value
 * *emits*; these cover how the value is arrived at — including the typo case,
 * which has to fall back rather than silently pick a different build shape.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const resolve = (options: LitPluginOptions, env: Record<string, string> = {}) =>
  resolveOptions(options, env);

describe('cssSheetBuild', () => {
  test(`defaults to 'auto'`, () => {
    expect(resolve({}).cssSheetBuild).toBe('auto');
  });

  test('reads LIT_PLUGIN_CSS_SHEET_BUILD', () => {
    expect(
      resolve({}, {LIT_PLUGIN_CSS_SHEET_BUILD: 'inline-raw'}).cssSheetBuild
    ).toBe('inline-raw');
    expect(resolve({}, {LIT_PLUGIN_CSS_SHEET_BUILD: 'url'}).cssSheetBuild).toBe(
      'url'
    );
  });

  test('explicit option wins over the env var', () => {
    expect(
      resolve({cssSheetBuild: 'url'}, {LIT_PLUGIN_CSS_SHEET_BUILD: 'inline'})
        .cssSheetBuild
    ).toBe('url');
  });

  test('an unrecognized env value warns and falls back to the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolve({}, {LIT_PLUGIN_CSS_SHEET_BUILD: 'inlined'}).cssSheetBuild
    ).toBe('auto');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('LIT_PLUGIN_CSS_SHEET_BUILD');
  });

  test('an unrecognized explicit value warns and defers to the env var', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolve(
        // Only reachable from JS callers; the type rules it out.
        {cssSheetBuild: 'raw' as LitPluginOptions['cssSheetBuild']},
        {LIT_PLUGIN_CSS_SHEET_BUILD: 'url'}
      ).cssSheetBuild
    ).toBe('url');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('cssSheetBuild');
  });

  test('an empty env value is treated as unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolve({}, {LIT_PLUGIN_CSS_SHEET_BUILD: ''}).cssSheetBuild).toBe(
      'auto'
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('hmr', () => {
  test('defaults to enabled, no reconnect, reload on incompatible', () => {
    const r = resolve({});
    expect(r.hmrEnabled).toBe(true);
    expect(r.reconnect).toBe(false);
    expect(r.onIncompatible).toBe('reload');
    expect(r.childState).toBe('transfer');
  });

  test('privateFields defaults to true; option and env can turn it off', () => {
    expect(resolve({}).privateFields).toBe(true);
    expect(resolve({hmr: {privateFields: false}}).privateFields).toBe(false);
    expect(
      resolve({}, {LIT_PLUGIN_HMR_PRIVATE_FIELDS: '0'}).privateFields
    ).toBe(false);
    expect(
      resolve(
        {hmr: {privateFields: true}},
        {LIT_PLUGIN_HMR_PRIVATE_FIELDS: '0'}
      ).privateFields
    ).toBe(true);
  });

  test('`hmr: false` and `hmr: {enabled: false}` both disable it', () => {
    expect(resolve({hmr: false}).hmrEnabled).toBe(false);
    expect(resolve({hmr: {enabled: false}}).hmrEnabled).toBe(false);
  });

  test('reads LIT_PLUGIN_HMR as true/false/1/0, ignoring anything else', () => {
    expect(resolve({}, {LIT_PLUGIN_HMR: 'false'}).hmrEnabled).toBe(false);
    expect(resolve({}, {LIT_PLUGIN_HMR: '0'}).hmrEnabled).toBe(false);
    expect(resolve({}, {LIT_PLUGIN_HMR: 'off'}).hmrEnabled).toBe(true);
  });

  test('explicit option wins over the env var', () => {
    expect(resolve({hmr: true}, {LIT_PLUGIN_HMR: 'false'}).hmrEnabled).toBe(
      true
    );
    // An object without `enabled` doesn't decide it, so the env var still can.
    expect(
      resolve({hmr: {reconnect: true}}, {LIT_PLUGIN_HMR: '0'}).hmrEnabled
    ).toBe(false);
  });

  test('reads reconnect and onIncompatible from options or env', () => {
    expect(resolve({hmr: {reconnect: true}}).reconnect).toBe(true);
    expect(resolve({}, {LIT_PLUGIN_HMR_RECONNECT: '1'}).reconnect).toBe(true);
    expect(resolve({hmr: {onIncompatible: 'warn'}}).onIncompatible).toBe(
      'warn'
    );
    expect(
      resolve({}, {LIT_PLUGIN_HMR_ON_INCOMPATIBLE: 'warn'}).onIncompatible
    ).toBe('warn');
    expect(
      resolve(
        {hmr: {onIncompatible: 'reload'}},
        {LIT_PLUGIN_HMR_ON_INCOMPATIBLE: 'warn'}
      ).onIncompatible
    ).toBe('reload');
  });
  test('an unrecognized LIT_PLUGIN_HMR_ON_INCOMPATIBLE warns and falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolve({}, {LIT_PLUGIN_HMR_ON_INCOMPATIBLE: 'warning'}).onIncompatible
    ).toBe('reload');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('LIT_PLUGIN_HMR_ON_INCOMPATIBLE');
  });

  test('reads childState from options or env, option first', () => {
    expect(resolve({hmr: {childState: 'reuse'}}).childState).toBe('reuse');
    expect(resolve({}, {LIT_PLUGIN_HMR_CHILD_STATE: 'reset'}).childState).toBe(
      'reset'
    );
    const r = resolve(
      {hmr: {childState: 'transfer'}},
      {LIT_PLUGIN_HMR_CHILD_STATE: 'reset'}
    );
    expect(r.childState).toBe('transfer');
    expect(r.sources.hmrChildState).toBe('option');
    expect(toFeatureSettings(r).hmr.childState).toBe('transfer');
  });

  test('an unrecognized LIT_PLUGIN_HMR_CHILD_STATE warns and falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolve({}, {LIT_PLUGIN_HMR_CHILD_STATE: 'keep'}).childState).toBe(
      'transfer'
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('LIT_PLUGIN_HMR_CHILD_STATE');
  });
});

describe('indicator', () => {
  test('defaults to shown, without a count', () => {
    expect(resolve({}).indicator).toEqual({count: false});
  });

  test('can be disabled by option or env', () => {
    expect(resolve({hmr: {indicator: false}}).indicator).toBe(false);
    expect(resolve({hmr: {indicator: {enabled: false}}}).indicator).toBe(false);
    expect(resolve({}, {LIT_PLUGIN_HMR_INDICATOR: 'false'}).indicator).toBe(
      false
    );
  });

  test('reads count from options or env', () => {
    expect(resolve({hmr: {indicator: {count: true}}}).indicator).toEqual({
      count: true,
    });
    expect(
      resolve({}, {LIT_PLUGIN_HMR_INDICATOR_COUNT: 'true'}).indicator
    ).toEqual({count: true});
  });

  test('follows the HMR master toggle', () => {
    expect(resolve({hmr: false}).indicator).toBe(false);
    expect(
      resolve({hmr: {enabled: false, indicator: {enabled: true}}}).indicator
    ).toBe(false);
  });
});

describe('sourceOverlay', () => {
  test('defaults to off', () => {
    expect(resolve({}).sourceOverlay).toBe(false);
  });

  test('`true` or an object turns it on', () => {
    expect(resolve({sourceOverlay: true}).sourceOverlay).toEqual({});
    expect(resolve({sourceOverlay: {key: 'Alt'}}).sourceOverlay).toEqual({
      key: 'Alt',
    });
  });

  test('LIT_PLUGIN_SOURCE_OVERLAY turns it on, and an explicit false wins', () => {
    const env = {LIT_PLUGIN_SOURCE_OVERLAY: 'true'};
    expect(resolve({}, env).sourceOverlay).toEqual({});
    expect(resolve({sourceOverlay: false}, env).sourceOverlay).toBe(false);
  });

  test('fills key, editor and throttle from env, under explicit values', () => {
    const env = {
      LIT_PLUGIN_SOURCE_OVERLAY_KEY: 'Shift',
      LIT_PLUGIN_SOURCE_OVERLAY_EDITOR: 'cursor',
      LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS: '50',
    };
    expect(resolve({sourceOverlay: true}, env).sourceOverlay).toEqual({
      key: 'Shift',
      editor: 'cursor',
      throttleMs: 50,
    });
    expect(
      resolve({sourceOverlay: {key: 'Alt', throttleMs: 10}}, env).sourceOverlay
    ).toMatchObject({key: 'Alt', editor: 'cursor', throttleMs: 10});
  });

  test('empty or non-numeric env values are ignored', () => {
    expect(
      resolve(
        {sourceOverlay: true},
        {
          LIT_PLUGIN_SOURCE_OVERLAY_KEY: '',
          LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS: 'fast',
        }
      ).sourceOverlay
    ).toEqual({key: undefined, editor: undefined, throttleMs: undefined});
  });

  test('does not mutate the caller’s options object', () => {
    const so = {key: 'Alt'};
    resolve({sourceOverlay: so}, {LIT_PLUGIN_SOURCE_OVERLAY_EDITOR: 'zed'});
    expect(so).toEqual({key: 'Alt'});
  });
});

describe('timeline', () => {
  test('defaults to off', () => {
    expect(resolve({}).timeline).toBe(false);
  });

  test('reads LIT_PLUGIN_TIMELINE, under an explicit option', () => {
    expect(resolve({}, {LIT_PLUGIN_TIMELINE: '1'}).timeline).toBe(true);
    expect(
      resolve({timeline: false}, {LIT_PLUGIN_TIMELINE: '1'}).timeline
    ).toBe(false);
  });
});

describe('sources', () => {
  test('an explicit option beats the env var', () => {
    const r = resolve(
      {sourceOverlay: {editor: 'cursor'}, hmr: {reconnect: true}},
      {
        LIT_PLUGIN_SOURCE_OVERLAY_EDITOR: 'zed',
        LIT_PLUGIN_HMR_RECONNECT: 'false',
      }
    );
    expect(r.sourceOverlay).toMatchObject({editor: 'cursor'});
    expect(r.reconnect).toBe(true);
    expect(r.sources).toMatchObject({
      sourceOverlayEditor: 'option',
      hmrReconnect: 'option',
    });
  });

  test('the env var beats the default', () => {
    const r = resolve(
      {sourceOverlay: true},
      {
        LIT_PLUGIN_SOURCE_OVERLAY_EDITOR: 'zed',
        LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS: '10',
        LIT_PLUGIN_HMR_ON_INCOMPATIBLE: 'warn',
      }
    );
    expect(r.sourceOverlay).toMatchObject({editor: 'zed', throttleMs: 10});
    expect(r.sources).toMatchObject({
      sourceOverlayEditor: 'env',
      sourceOverlayThrottleMs: 'env',
      hmrOnIncompatible: 'env',
    });
  });

  test('with neither set, every source is the default', () => {
    expect(resolve({sourceOverlay: true}).sources).toEqual({
      hmr: 'default',
      sourceOverlay: 'option',
      timeline: 'default',
      hmrReconnect: 'default',
      hmrOnIncompatible: 'default',
      hmrChildState: 'default',
      hmrIndicatorVisible: 'default',
      hmrIndicatorCount: 'default',
      sourceOverlayKey: 'default',
      sourceOverlayEditor: 'default',
      sourceOverlayThrottleMs: 'default',
    });
  });

  test('the feature switches report where they were turned on or off', () => {
    expect(
      resolve(
        {hmr: false},
        {LIT_PLUGIN_SOURCE_OVERLAY: 'true', LIT_PLUGIN_TIMELINE: '0'}
      ).sources
    ).toMatchObject({hmr: 'option', sourceOverlay: 'env', timeline: 'env'});
    // `hmr: {...}` configures HMR without saying whether it is on.
    expect(resolve({hmr: {reconnect: true}}).sources.hmr).toBe('default');
  });

  test('omits source-overlay sources while the overlay is off', () => {
    expect(resolve({}).sources).not.toHaveProperty('sourceOverlayEditor');
  });

  test('an unknown env editor warns and resolves to the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = resolve(
      {sourceOverlay: true},
      {LIT_PLUGIN_SOURCE_OVERLAY_EDITOR: 'notepad'}
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'LIT_PLUGIN_SOURCE_OVERLAY_EDITOR'
    );
    expect(r.sourceOverlay).toMatchObject({editor: undefined});
    expect(r.sources.sourceOverlayEditor).toBe('default');
    expect(toFeatureSettings(r).sourceOverlay.editor).toBe('vscode');
  });

  test('an env editor under an explicit one is not validated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolve(
      {sourceOverlay: {editor: 'zed'}},
      {LIT_PLUGIN_SOURCE_OVERLAY_EDITOR: 'notepad'}
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('toFeatureSettings', () => {
  test('carries the sources map alongside the effective values', () => {
    const f = toFeatureSettings(
      resolve(
        {sourceOverlay: {key: 'k'}, hmr: {indicator: {count: true}}},
        {
          LIT_PLUGIN_SOURCE_OVERLAY_EDITOR: 'zed',
          LIT_PLUGIN_HMR_RECONNECT: '1',
        }
      )
    );
    expect(f.sourceOverlay).toEqual({
      enabled: true,
      key: 'k',
      editor: 'zed',
      throttleMs: 50,
    });
    expect(f.sources).toEqual({
      hmr: 'default',
      sourceOverlay: 'option',
      timeline: 'default',
      hmrReconnect: 'env',
      hmrOnIncompatible: 'default',
      hmrChildState: 'default',
      hmrIndicatorVisible: 'default',
      hmrIndicatorCount: 'option',
      sourceOverlayKey: 'option',
      sourceOverlayEditor: 'env',
      sourceOverlayThrottleMs: 'default',
    });
  });

  test('a custom editor object reports as a custom option', () => {
    const f = toFeatureSettings(
      resolve({
        sourceOverlay: {
          editor: {name: 'X', url: (path, line) => `x://${path}:${line}`},
        },
      })
    );
    expect(f.sourceOverlay.editor).toBe('custom');
    expect(f.sources?.sourceOverlayEditor).toBe('option');
  });
});
