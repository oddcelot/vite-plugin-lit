/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterEach, describe, expect, test, vi} from 'vitest';
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
