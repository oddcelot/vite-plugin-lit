/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vite-plus/test';
import {buildSpotlightClipPath} from '../../lib/runtime/source-overlay/mask-path.js';
import {
  BUILTIN_EDITORS,
  resolveEditor,
} from '../../lib/runtime/source-overlay/editors.js';

describe('buildSpotlightClipPath', () => {
  test('wraps the outer rect and the rounded hole in one path()', () => {
    expect(buildSpotlightClipPath(10, 20, 100, 50, 4)).toBe(
      "path('M 0 0 H 9999 V 9999 H 0 Z " +
        'M 14 20 Q 10 20 10 24 L 10 66 Q 10 70 14 70 ' +
        "L 106 70 Q 110 70 110 66 L 110 24 Q 110 20 106 20 Z')"
    );
  });

  test('a zero radius gives square corners', () => {
    const path = buildSpotlightClipPath(0, 0, 10, 10, 0);
    expect(path).toContain('M 0 0 Q 0 0 0 0');
    expect(path).toContain('L 10 10');
  });

  test('clamps the radius to half the width', () => {
    expect(buildSpotlightClipPath(0, 0, 10, 100, 50)).toBe(
      buildSpotlightClipPath(0, 0, 10, 100, 5)
    );
  });

  test('clamps the radius to half the height', () => {
    expect(buildSpotlightClipPath(0, 0, 100, 10, 50)).toBe(
      buildSpotlightClipPath(0, 0, 100, 10, 5)
    );
  });

  test('leaves a radius that already fits untouched', () => {
    expect(buildSpotlightClipPath(0, 0, 100, 100, 8)).not.toBe(
      buildSpotlightClipPath(0, 0, 100, 100, 9)
    );
  });
});

describe('resolveEditor', () => {
  test('defaults to VS Code when undefined', () => {
    expect(resolveEditor(undefined)).toBe(BUILTIN_EDITORS.vscode);
  });

  test('falls back to VS Code for an unknown name', () => {
    expect(resolveEditor('emacs')).toBe(BUILTIN_EDITORS.vscode);
  });

  test('resolves a builtin name', () => {
    const zed = resolveEditor('zed');
    expect(zed).toBe(BUILTIN_EDITORS.zed);
    expect(zed.url('/a.ts', 3)).toBe('zed://file/a.ts:3');
  });

  test('puts one slash between file and a POSIX path', () => {
    for (const name of ['vscode', 'cursor', 'zed', 'windsurf']) {
      expect(BUILTIN_EDITORS[name].url('/Users/me/a.ts', 3)).toBe(
        `${name}://file/Users/me/a.ts:3`
      );
    }
  });

  test('leaves Windows drive and UNC paths intact', () => {
    const {url} = BUILTIN_EDITORS.vscode;
    expect(url('C:/proj/a.ts', 3)).toBe('vscode://file/C:/proj/a.ts:3');
    expect(url('//server/share/a.ts', 3)).toBe(
      'vscode://file//server/share/a.ts:3'
    );
  });

  test('builds an idea url with an encoded path', () => {
    expect(resolveEditor('idea').url('/a b.ts', 3)).toBe(
      'idea://open?file=%2Fa%20b.ts&line=3'
    );
  });

  test('returns a custom config as given', () => {
    const custom = {
      name: 'Mine',
      url: (p: string, l: number) => `mine:${p}:${l}`,
    };
    expect(resolveEditor(custom)).toBe(custom);
  });
});
