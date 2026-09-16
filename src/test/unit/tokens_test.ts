/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vitest';
import {tokenStyleText} from '../../lib/tokens.js';

/**
 * The token stylesheet is injected into two very different documents: the
 * host page (indicator, source-overlay) and the panel's own document. Setting
 * `color-scheme` on the HOST page's `:root` makes the UA repaint the canvas
 * dark for apps that never declare an opaque background — a real regression
 * observed in embedding apps. Host-page injection must therefore ship custom
 * properties only; the panel opts into `color-scheme` for its own document.
 */
describe('tokenStyleText', () => {
  test('default (host page) carries no color-scheme declaration', () => {
    const text = tokenStyleText();
    // `prefers-color-scheme` (the media feature) is expected; the property
    // declaration is not.
    expect(text).not.toMatch(/(?<!prefers-)color-scheme\s*:/);
  });

  test('default still defines the semantic token custom properties', () => {
    const text = tokenStyleText();
    expect(text).toContain('--lit-devtools-bg:');
    expect(text).toContain('--lit-devtools-accent:');
    expect(text).toContain('@media (prefers-color-scheme: light)');
    expect(text).toContain(':root.color-scheme-light');
    expect(text).toContain(':root.color-scheme-dark');
  });

  test('colorScheme: true (panel document) declares both schemes', () => {
    const text = tokenStyleText({colorScheme: true});
    expect(text).toContain('color-scheme: dark;');
    expect(text).toContain('color-scheme: light;');
  });
});
