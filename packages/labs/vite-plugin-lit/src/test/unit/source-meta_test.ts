/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vitest';
import MagicString from 'magic-string';
import {
  injectSourceMeta,
  lineNumberAt,
  SOURCE_META_SYM,
} from '../../lib/source-meta.js';

const run = (code: string, filePath = '/app/src/my-el.ts') => {
  const ms = new MagicString(code);
  const changed = injectSourceMeta(code, filePath, ms);
  return {changed, out: ms.toString()};
};

describe('injectSourceMeta', () => {
  test('same-line decorator', () => {
    const code =
      `import {LitElement} from 'lit';\n` +
      `import {customElement} from 'lit/decorators.js';\n` +
      `@customElement('my-el') export class MyEl extends LitElement {}\n`;
    const {changed, out} = run(code);
    expect(changed).toBe(true);
    expect(out).toContain(`MyEl[${SOURCE_META_SYM}]=`);
    expect(out).toContain(`componentName:"MyEl"`);
    expect(out).toContain(`filePath:"/app/src/my-el.ts"`);
  });

  test('next-line decorator', () => {
    const code =
      `import {LitElement} from 'lit';\n` +
      `import {customElement} from 'lit/decorators.js';\n` +
      `@customElement('my-el')\nexport class MyEl extends LitElement {}\n`;
    const {changed, out} = run(code);
    expect(changed).toBe(true);
    expect(out).toContain(`MyEl[${SOURCE_META_SYM}]=`);
    expect(out).toContain(`componentName:"MyEl"`);
  });

  test('customElements.define with a locally-declared class', () => {
    const code =
      `class Plain extends HTMLElement {}\n` +
      `customElements.define('plain-el', Plain);\n`;
    const {changed, out} = run(code);
    expect(changed).toBe(true);
    expect(out).toContain(`Plain[${SOURCE_META_SYM}]=`);
    expect(out).toContain(`componentName:"Plain"`);
  });

  test('customElements.define with an imported class is skipped', () => {
    const code =
      `import {Foo} from './foo.js';\n` +
      `customElements.define('foo-el', Foo);\n`;
    const {changed, out} = run(code);
    expect(changed).toBe(false);
    expect(out).not.toContain(`Foo[${SOURCE_META_SYM}]`);
  });

  test('esbuild __decorateClass output', () => {
    const code =
      `import {customElement} from 'lit/decorators.js';\n` +
      `let MyEl = class MyEl extends HTMLElement {};\n` +
      `MyEl = __decorateClass([customElement('my-el')], MyEl);\n`;
    const {changed, out} = run(code);
    expect(changed).toBe(true);
    expect(out).toContain(`MyEl[${SOURCE_META_SYM}]=`);
  });
});

describe('injectSourceMeta guard behavior', () => {
  test('idempotent when metadata already present', () => {
    const base =
      `import {LitElement} from 'lit';\n` +
      `import {customElement} from 'lit/decorators.js';\n` +
      `@customElement('my-el') export class MyEl extends LitElement {}\n`;
    const code = base + `\nFoo[${SOURCE_META_SYM}]={};\n`;
    const {changed} = run(code);
    expect(changed).toBe(false);
  });

  test('non-component module returns false unchanged', () => {
    const code = `export const x = 1;\n`;
    const {changed, out} = run(code);
    expect(changed).toBe(false);
    expect(out).toBe(code);
  });

  test('injects each class at most once when multiple patterns match', () => {
    const code =
      `import {LitElement} from 'lit';\n` +
      `import {customElement} from 'lit/decorators.js';\n` +
      `@customElement('my-el') export class MyEl extends LitElement {}\n` +
      `customElements.define('my-el', MyEl);\n`;
    const {out} = run(code);
    expect(out.split(`MyEl[${SOURCE_META_SYM}]=`).length - 1).toBe(1);
  });
});

describe('lineNumberAt', () => {
  test('returns 1-based line numbers', () => {
    const code = 'a\nb\nc';
    expect(lineNumberAt(code, 0)).toBe(1);
    expect(lineNumberAt(code, 2)).toBe(2);
    expect(lineNumberAt(code, 4)).toBe(3);
  });
});

describe('injectSourceMeta nested braces', () => {
  test('does not stop at inner } in a class body', () => {
    const code =
      `@customElement('my-el')\n` +
      `export class MyEl extends HTMLElement {\n` +
      `  styles() { return {a: {b: 1}}; }\n` +
      `}\n`;
    const {changed, out} = run(code);
    expect(changed).toBe(true);
    expect(out).toContain(`MyEl[${SOURCE_META_SYM}]=`);
  });
});
