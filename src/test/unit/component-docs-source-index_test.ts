import {expect, test} from 'vite-plus/test';
import {extractModuleDocs} from '../../lib/component-docs/extract.js';
import {createSourceDocsIndex} from '../../lib/component-docs/source-index.js';

const index = () => {
  const docs = createSourceDocsIndex((id) => id.replace('/app/', ''));
  const add = (
    id: string,
    code: string,
    superclassIds: Record<string, string> = {}
  ) =>
    docs.set(
      id,
      extractModuleDocs(code, id),
      new Map(Object.entries(superclassIds))
    );
  return {docs, add};
};

const BASE = `
  /**
   * @fires change - Base change
   * @slot - Base content
   */
  export class Base extends LitElement {
    /** The base value. */
    @property() value = '';
    /** Overridden below. */
    @property() size = 'm';
  }
`;

test('walks the superclass chain across modules', () => {
  const {docs, add} = index();
  add('/app/src/base.ts', BASE);
  add(
    '/app/src/x-a.ts',
    `
    import {Base} from './base.js';
    /**
     * @fires change - Own change
     */
    @customElement('x-a')
    export class XA extends Base {
      /** Own size. */
      @property() size = 'l';
    }
  `,
    {'./base.js': '/app/src/base.ts?v=1'}
  );
  const result = docs.get('x-a')!;
  expect(result.className).toBe('XA');
  expect(result.origin).toEqual({
    manifest: '',
    module: 'src/x-a.ts',
    source: true,
  });
  expect(result.properties).toEqual([
    {
      name: 'size',
      description: 'Own size.',
      default: "'l'",
      counterpart: 'size',
    },
    {
      name: 'value',
      description: 'The base value.',
      default: "''",
      counterpart: 'value',
      inheritedFrom: 'Base',
    },
  ]);
  expect(result.events).toEqual([{name: 'change', description: 'Own change'}]);
  expect(result.slots).toEqual([
    {name: '', description: 'Base content', inheritedFrom: 'Base'},
  ]);
  expect(result.attributes.map((a) => [a.name, a.inheritedFrom])).toEqual([
    ['size', undefined],
    ['value', 'Base'],
  ]);
});

test('follows a superclass in the same module, and stops at unknown ones', () => {
  const {docs, add} = index();
  add(
    '/app/src/two.ts',
    `${BASE}
    class XB extends Base {}
    customElements.define('x-b', XB);
  `
  );
  expect(docs.get('x-b')!.properties.map((p) => p.inheritedFrom)).toEqual([
    'Base',
    'Base',
  ]);
  expect(docs.get('x-nope')).toBeUndefined();
});

test('a base that is not stored yet is simply not merged', () => {
  const {docs, add} = index();
  add(
    '/app/src/x-c.ts',
    `import {Base} from './base.js';
    @customElement('x-c') class XC extends Base {}`,
    {'./base.js': '/app/src/base.ts'}
  );
  expect(docs.get('x-c')!.properties).toEqual([]);
  add('/app/src/base.ts', BASE);
  expect(docs.get('x-c')!.properties).toHaveLength(2);
});

test('a superclass cycle ends the walk', () => {
  const {docs, add} = index();
  add(
    '/app/src/a.ts',
    `import {B} from './b.js';
    /** @slot a */
    @customElement('x-cycle') export class A extends B {}`,
    {'./b.js': '/app/src/b.ts'}
  );
  add(
    '/app/src/b.ts',
    `import {A} from './a.js';
    /** @slot b */
    export class B extends A {}`,
    {'./a.js': '/app/src/a.ts'}
  );
  expect(docs.get('x-cycle')!.slots.map((s) => s.name)).toEqual(['a', 'b']);
});

test('delete forgets a module, and set replaces it', () => {
  const {docs, add} = index();
  add('/app/src/x-d.ts', `@customElement('x-d') class XD {}`);
  expect(docs.get('x-d')).toBeDefined();
  add('/app/src/x-d.ts', `@customElement('x-e') class XD {}`);
  expect(docs.get('x-d')).toBeUndefined();
  expect(docs.get('x-e')).toBeDefined();
  docs.delete('/app/src/x-d.ts?t=1');
  expect(docs.get('x-e')).toBeUndefined();
});

test('the returned docs are a copy', () => {
  const {docs, add} = index();
  add('/app/src/x-f.ts', `@customElement('x-f') class XF { a = 1 }`);
  docs.get('x-f')!.properties.push({name: 'b'});
  expect(docs.get('x-f')!.properties).toHaveLength(1);
});
