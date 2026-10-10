import {expect, test} from 'vite-plus/test';
import {createSourceDocsIndex} from '../../lib/component-docs/source-index.js';
import {createNodeActions} from '../../lib/devframe/node-actions.js';
import {litPlugin} from '../../lib/plugin.js';
import {createOptionsContext} from '../../lib/plugins/context.js';
import {litComponentDocs} from '../../lib/plugins/component-docs.js';

const setup = (enabled = true) => {
  const index = createSourceDocsIndex((id) => id.replace('/app/', ''));
  const plugin = litComponentDocs(
    createOptionsContext({}),
    index,
    () => enabled
  );
  const resolved: string[] = [];
  const context = {
    resolve: async (specifier: string) => {
      resolved.push(specifier);
      return specifier === 'lit'
        ? {id: 'lit', external: true}
        : {id: `/app/src/${specifier.replace('./', '').replace('.js', '.ts')}`};
    },
  };
  const hook = plugin.transform as unknown as (
    this: typeof context,
    code: string,
    id: string,
    opts?: {ssr?: boolean}
  ) => Promise<null>;
  const transform = (code: string, id: string, opts = {}) =>
    hook.call(context, code, id, opts);
  const watch = plugin.watchChange as unknown as (
    id: string,
    change: {event: string}
  ) => void;
  return {index, plugin, transform, watch, resolved};
};

const BASE = `
  import {LitElement} from 'lit';
  export class Base extends LitElement {
    /** From the base. */
    value = '';
  }
`;

test('stores transformed modules and resolves imported superclasses', async () => {
  const {index, plugin, transform, resolved} = setup();
  expect(plugin.enforce).toBe('pre');
  expect(plugin.apply).toBe('serve');
  expect(await transform(BASE, '/app/src/base.ts')).toBeNull();
  await transform(
    `import {Base} from './base.js';
    @customElement('x-sub') export class Sub extends Base {}`,
    '/app/src/sub.ts?t=1'
  );
  expect(resolved).toEqual(['lit', './base.js']);
  const docs = index.get('x-sub')!;
  expect(docs.origin).toEqual({
    manifest: '',
    module: 'src/sub.ts',
    source: true,
  });
  expect(docs.properties).toEqual([
    {
      name: 'value',
      description: 'From the base.',
      default: "''",
      inheritedFrom: 'Base',
    },
  ]);
});

test('skips dependencies, SSR, and everything while disabled', async () => {
  const code = `@customElement('x-a') class A {}`;
  const on = setup();
  await on.transform(code, '/app/node_modules/x/a.js');
  await on.transform(code, '/app/src/a.ts', {ssr: true});
  expect(on.index.get('x-a')).toBeUndefined();
  const off = setup(false);
  await off.transform(code, '/app/src/a.ts');
  expect(off.index.get('x-a')).toBeUndefined();
});

test('an edit that removes the class, or deleting the file, forgets it', async () => {
  const {index, transform, watch} = setup();
  await transform(`@customElement('x-a') class A {}`, '/app/src/a.ts');
  await transform(`export const a = 1;`, '/app/src/a.ts');
  expect(index.get('x-a')).toBeUndefined();
  await transform(`@customElement('x-a') class A {}`, '/app/src/a.ts');
  watch('/app/src/a.ts', {event: 'update'});
  expect(index.get('x-a')).toBeDefined();
  watch('/app/src/a.ts', {event: 'delete'});
  expect(index.get('x-a')).toBeUndefined();
});

test('componentDocs answers from source before reading manifests', async () => {
  const {index, transform} = setup();
  await transform(`@customElement('x-src') class XSrc {}`, '/app/src/x.ts');
  const actions = createNodeActions({sourceDocs: () => index});
  const {docs} = await actions.componentDocs({tagName: 'x-src'});
  expect(docs?.className).toBe('XSrc');
});

test('litPlugin registers it before the source overlay, unless DevTools is off', () => {
  const names = (plugins: {name: string}[]) => plugins.map((p) => p.name);
  const on = names(litPlugin());
  expect(on.indexOf('lit-component-docs')).toBeGreaterThan(-1);
  expect(on.indexOf('lit-component-docs')).toBeLessThan(
    on.indexOf('lit-source-overlay')
  );
  expect(names(litPlugin({timeline: false}))).not.toContain(
    'lit-component-docs'
  );
});
