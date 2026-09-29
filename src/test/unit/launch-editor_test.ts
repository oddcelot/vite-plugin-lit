/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vite-plus/test';
import {
  resolveLaunchEditor,
  toLaunchEditor,
} from '../../lib/devframe/launch-editor.js';
import {BUILTIN_EDITORS} from '../../lib/runtime/source-overlay/editors.js';

describe('toLaunchEditor', () => {
  test('maps overlay keys to launch-editor commands', () => {
    expect(toLaunchEditor('vscode')).toBe('code');
    expect(toLaunchEditor('cursor')).toBe('cursor');
    expect(toLaunchEditor('zed')).toBe('zed');
    expect(toLaunchEditor('idea')).toBe('idea');
  });

  test('leaves keys with no command to auto-detection', () => {
    expect(toLaunchEditor('windsurf')).toBeUndefined();
    expect(toLaunchEditor('custom')).toBeUndefined();
    expect(toLaunchEditor('nope')).toBeUndefined();
    expect(toLaunchEditor('constructor')).toBeUndefined();
    expect(toLaunchEditor(undefined)).toBeUndefined();
  });

  test('every builtin overlay key is either mapped or deliberately not', () => {
    // A new overlay editor should make someone decide, not silently fall
    // back to auto-detect.
    const unmapped = Object.keys(BUILTIN_EDITORS).filter(
      (k) => toLaunchEditor(k) === undefined
    );
    expect(unmapped).toEqual(['windsurf']);
  });
});

describe('resolveLaunchEditor', () => {
  test('override beats config, config beats nothing', () => {
    expect(resolveLaunchEditor('zed', {sourceOverlayEditor: 'cursor'})).toBe(
      'cursor'
    );
    expect(resolveLaunchEditor('zed', {})).toBe('zed');
    expect(resolveLaunchEditor('zed', undefined)).toBe('zed');
  });

  test('stays undefined when nobody chose', () => {
    expect(resolveLaunchEditor(undefined, undefined)).toBeUndefined();
    expect(resolveLaunchEditor(undefined, {})).toBeUndefined();
  });

  test('an override without a command does not fall through to config', () => {
    expect(
      resolveLaunchEditor('zed', {sourceOverlayEditor: 'windsurf'})
    ).toBeUndefined();
  });
});
