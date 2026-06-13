/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vitest';
import {
  INSTALL_ID,
  VIRTUAL_PREFIX,
  isComponentModule,
  transformLitModule,
} from '../../lib/transform.js';
import {litPlugin} from '../../lib/plugin.js';

const COMPONENT = `import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
@customElement('my-el')
export class MyEl extends LitElement {
  render() { return html\`<p>hi</p>\`; }
}
`;

describe('transformLitModule', () => {
  test('rewrites static lit imports to wrapper modules', async () => {
    const result = await transformLitModule(COMPONENT);
    expect(result).not.toBeNull();
    expect(result!.code).toContain(`from '${VIRTUAL_PREFIX}lit'`);
    // Non-wrapped lit-family subpaths are left alone.
    expect(result!.code).toContain(`from 'lit/decorators.js'`);
  });

  test('rewrites export-from specifiers', async () => {
    const result = await transformLitModule(`export {html, css} from 'lit';\n`);
    expect(result!.code).toContain(
      `export {html, css} from '${VIRTUAL_PREFIX}lit';`
    );
  });

  test('rewrites string-literal dynamic imports', async () => {
    const result = await transformLitModule(
      `const lit = await import('lit-html');\n`
    );
    expect(result!.code).toContain(`import('${VIRTUAL_PREFIX}lit-html')`);
  });

  test('leaves variable dynamic imports alone', async () => {
    const code = `const spec = 'lit';\nexport const load = () => import(spec);\n`;
    expect(await transformLitModule(code)).toBeNull();
  });

  test('rewrites every wrap-table specifier', async () => {
    for (const spec of [
      'lit',
      'lit/html.js',
      'lit/static-html.js',
      'lit-html',
      'lit-html/static.js',
      'lit-element',
      'lit-element/lit-element.js',
      '@lit/reactive-element',
      '@lit/reactive-element/css-tag.js',
      '@lit-labs/signals',
    ]) {
      const result = await transformLitModule(
        `import {html} from '${spec}';\n`
      );
      expect(result?.code, spec).toContain(`'${VIRTUAL_PREFIX}${spec}'`);
    }
  });

  test('injects install + self-accept for component modules', async () => {
    const result = await transformLitModule(COMPONENT);
    expect(result!.code.startsWith(`import '${INSTALL_ID}';\n`)).toBe(true);
    expect(result!.code).toContain('import.meta.hot?.accept();');
  });

  test('injects for plain customElements.define modules without lit', async () => {
    const code = `class Plain extends HTMLElement {}\ncustomElements.define('plain-el', Plain);\n`;
    const result = await transformLitModule(code);
    expect(result!.code.startsWith(`import '${INSTALL_ID}';\n`)).toBe(true);
    expect(result!.code).toContain('import.meta.hot?.accept();');
  });

  test('does not inject install/accept for non-component lit modules', async () => {
    const result = await transformLitModule(
      `import {html} from 'lit';\nexport const header = html\`<h2>x</h2>\`;\n`
    );
    expect(result!.code).not.toContain('install');
    expect(result!.code).not.toContain('import.meta.hot');
  });

  test('returns null for unrelated modules', async () => {
    expect(await transformLitModule(`export const x = 1;\n`)).toBeNull();
  });

  test('is idempotent on its own output', async () => {
    const once = await transformLitModule(COMPONENT);
    expect(await transformLitModule(once!.code)).toBeNull();
  });

  test('produces a sourcemap', async () => {
    const result = await transformLitModule(COMPONENT);
    expect(result!.map).toBeTruthy();
    expect(result!.map.mappings.length).toBeGreaterThan(0);
  });
});

describe('isComponentModule', () => {
  test('detects customElements.define textually', () => {
    expect(isComponentModule(`customElements.define('x-y', XY);`, false)).toBe(
      true
    );
  });

  test('detects customElement decorator calls only with lit imports', () => {
    const code = `customElement('x-y')(XY);`;
    expect(isComponentModule(code, true)).toBe(true);
    expect(isComponentModule(code, false)).toBe(false);
  });
});

describe('litPlugin transform filter', () => {
  const plugin = litPlugin().find((p) => p.name === 'lit-plugin')!;
  const callTransform = (code: string, id: string, ssr?: boolean) => {
    const hook = plugin.transform as (
      code: string,
      id: string,
      opts?: {ssr?: boolean}
    ) => Promise<unknown>;
    return hook.call(undefined, code, id, ssr ? {ssr} : undefined);
  };

  test('skips node_modules', async () => {
    expect(
      await callTransform(COMPONENT, '/repo/node_modules/lib/index.js')
    ).toBeNull();
  });

  test('skips virtual ids', async () => {
    expect(await callTransform(COMPONENT, '\0some-virtual')).toBeNull();
  });

  test('skips ssr transforms', async () => {
    expect(await callTransform(COMPONENT, '/app/src/el.ts', true)).toBeNull();
  });

  test('skips non-JS assets', async () => {
    expect(await callTransform(COMPONENT, '/app/src/styles.css')).toBeNull();
  });

  test('transforms user TS modules', async () => {
    expect(await callTransform(COMPONENT, '/app/src/el.ts')).not.toBeNull();
  });

  test('transforms inline html-proxy scripts', async () => {
    expect(
      await callTransform(COMPONENT, '/app/index.html?html-proxy&index=0.js')
    ).not.toBeNull();
  });
});

describe('litPlugin ?hmr-url css query', () => {
  const plugin = litPlugin().find((p) => p.name === 'lit-css-query')!;
  const fakeCtx = {
    resolve: async (source: string) => ({id: `/app/src/${source.slice(2)}`}),
  };
  const callResolveId = (id: string, importer?: string) =>
    (
      plugin.resolveId as unknown as (
        this: typeof fakeCtx,
        id: string,
        importer?: string
      ) => Promise<string | null>
    ).call(fakeCtx, id, importer);
  const callLoad = (id: string) =>
    (plugin.load as unknown as (id: string) => string | null)(id);

  test('resolves css hmr-url imports to a virtual JS id', async () => {
    expect(await callResolveId('./box.css?hmr-url', '/app/src/el.ts')).toBe(
      '\0lit-plugin:hmr-url:/app/src/box.css.js'
    );
  });

  test('ignores other css imports', async () => {
    expect(await callResolveId('./box.css?url', '/app/src/el.ts')).toBeNull();
    expect(await callResolveId('./box.css', '/app/src/el.ts')).toBeNull();
  });

  test('loads a wrapper importing ?url through devCacheBust', () => {
    const code = callLoad('\0lit-plugin:hmr-url:/app/src/box.css.js')!;
    expect(code).toContain('"/app/src/box.css?url"');
    expect(code).toContain('devCacheBust(url)');
    expect(callLoad('/app/src/el.ts')).toBeNull();
  });
});

describe('litPlugin css literals plugin', () => {
  const STYLED =
    'const styles = css`#box { color: red; &:hover { background: oklch(62% 0.19 25); } }`;';

  const makePlugin = async (transformer: string) => {
    const plugin = litPlugin().find((p) => p.name === 'lit-css-literals')!;
    await (
      plugin.configResolved as unknown as (config: unknown) => Promise<void>
    )({
      command: 'serve',
      css: {transformer, lightningcss: {targets: {chrome: 100 << 16}}},
    });
    return plugin;
  };
  const callTransform = (plugin: unknown, code: string, id: string) =>
    (
      (plugin as {transform: unknown}).transform as (
        this: {warn: (msg: string) => void},
        code: string,
        id: string
      ) => {code: string} | null
    ).call({warn: () => {}}, code, id);

  test('inert unless css.transformer is lightningcss', async () => {
    const plugin = await makePlugin('postcss');
    expect(callTransform(plugin, STYLED, '/app/src/el.ts')).toBeNull();
  });

  test('downlevels css literals for the configured targets', async () => {
    const plugin = await makePlugin('lightningcss');
    const result = callTransform(plugin, STYLED, '/app/src/el.ts')!;
    expect(result.code).toContain('#box:hover');
    expect(result.code).not.toContain('&:hover');
    expect(result.code).not.toContain('oklch');
  });

  test('leaves literals with interpolations or escapes alone', async () => {
    const plugin = await makePlugin('lightningcss');
    const holes = 'const s = css`#box { color: ${color}; }`;';
    expect(callTransform(plugin, holes, '/app/src/el.ts')).toBeNull();
    const escapes = 'const s = css`#box::before { content: "\\2014"; }`;';
    expect(callTransform(plugin, escapes, '/app/src/el.ts')).toBeNull();
  });

  test('skips node_modules and non-css-tag templates', async () => {
    const plugin = await makePlugin('lightningcss');
    expect(
      callTransform(plugin, STYLED, '/repo/node_modules/lib/el.js')
    ).toBeNull();
    const otherTag = 'const s = unsafeCSS`#box { &:hover { color: red; } }`;';
    expect(callTransform(plugin, otherTag, '/app/src/el.ts')).toBeNull();
  });
});
