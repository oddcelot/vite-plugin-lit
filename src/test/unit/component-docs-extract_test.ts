import {describe, expect, test} from 'vite-plus/test';
import {extractModuleDocs} from '../../lib/component-docs/extract.js';

const only = (code: string, id = '/app/src/el.ts') => {
  const {classes} = extractModuleDocs(code, id);
  expect(classes).toHaveLength(1);
  return classes[0];
};

describe('tags', () => {
  test('from @customElement on an exported class', () => {
    const cls = only(`
      import {LitElement} from 'lit';
      import {customElement} from 'lit/decorators.js';
      @customElement('x-a')
      export class XA extends LitElement {}
    `);
    expect(cls).toMatchObject({
      name: 'XA',
      tagName: 'x-a',
      superclass: {name: 'LitElement', specifier: 'lit'},
    });
  });

  test('from customElements.define in the same module', () => {
    const {classes} = extractModuleDocs(
      `
      class XB extends HTMLElement {}
      class Other {}
      if (!customElements.get('x-b')) window.customElements.define('x-b', XB);
    `,
      '/app/src/b.js'
    );
    expect(classes.map((c) => [c.name, c.tagName])).toEqual([
      ['XB', 'x-b'],
      ['Other', undefined],
    ]);
    expect(classes[0].superclass).toEqual({name: 'HTMLElement'});
  });

  test('a renamed and a default import keep the exported name', () => {
    const {classes} = extractModuleDocs(
      `
      import {Base as B} from './base.js';
      import D from './d.js';
      export class One extends B {}
      export default class extends D {}
    `,
      '/app/src/x.ts'
    );
    expect(classes[0].superclass).toEqual({
      name: 'Base',
      specifier: './base.js',
    });
    expect(classes[1]).toMatchObject({
      name: 'default',
      isDefaultExport: true,
      superclass: {name: 'default', specifier: './d.js'},
    });
  });

  test('a mixin call is not followed', () => {
    const cls = only(`class X extends Mixin(LitElement) {}`);
    expect(cls.superclass).toBeUndefined();
  });
});

describe('class JSDoc', () => {
  const docs = only(`
    /**
     * A button that
     * presses.
     *
     * @summary Presses things.
     * @deprecated Use x-new.
     * @fires press - When pressed
     * @event {CustomEvent<{id: string}>} picked - With a detail
     * @fires bare
     * @slot - The label
     * @slot icon - An icon
     * @slot suffix Without a dash
     * @csspart base - The wrapper
     * @cssprop [--x-gap=4px] - The gap
     * @cssproperty --x-color - The color
     *   over two lines
     * @cssprop {<length>} --x-size
     * @cssstate pressed - While pressed
     */
    @customElement('x-button')
    export class XButton extends LitElement {}
  `).docs;

  test('description, summary and deprecation', () => {
    expect(docs.description).toBe('A button that\npresses.');
    expect(docs.summary).toBe('Presses things.');
    expect(docs.deprecated).toBe('Use x-new.');
  });

  test('events, with or without a type and a description', () => {
    expect(docs.events).toEqual([
      {name: 'press', description: 'When pressed'},
      {
        name: 'picked',
        type: 'CustomEvent<{id: string}>',
        description: 'With a detail',
      },
      {name: 'bare'},
    ]);
  });

  test('slots, the default one unnamed', () => {
    expect(docs.slots).toEqual([
      {name: '', description: 'The label'},
      {name: 'icon', description: 'An icon'},
      {name: 'suffix', description: 'Without a dash'},
    ]);
  });

  test('parts, CSS properties and states', () => {
    expect(docs.cssParts).toEqual([{name: 'base', description: 'The wrapper'}]);
    expect(docs.cssProperties).toEqual([
      {name: '--x-gap', default: '4px', description: 'The gap'},
      {name: '--x-color', description: 'The color\n  over two lines'},
      {name: '--x-size', type: '<length>'},
    ]);
    expect(docs.cssStates).toEqual([
      {name: 'pressed', description: 'While pressed'},
    ]);
  });

  test('a bare @deprecated, and a comment between decorator and class', () => {
    const cls = only(`
      @customElement('x-old')
      /** Old. */
      class XOld extends LitElement {}
    `);
    expect(cls.docs.description).toBe('Old.');
    const bare = only(`/**\n * @deprecated\n */\nclass XOld {}`);
    expect(bare.docs.deprecated).toBe(true);
  });

  test('a comment separated by code is not the class doc', () => {
    const cls = only(`/** Not mine. */\nconst a = 1;\nclass X {}`);
    expect(cls.docs.description).toBeUndefined();
  });
});

describe('members', () => {
  const docs = only(`
    @customElement('x-m')
    export class XM extends LitElement {
      /** The size. */
      @property({reflect: true}) size: 'small' | 'large' = 'small';
      /** @deprecated Use size. */
      @property({attribute: 'is-big', type: Boolean}) big = false;
      @property({attribute: false}) data: {a: number} | null = null;
      /** Plain field. */
      label = 'x';
      @state() private _open = false;
      @state() hidden = false;
      private secret = 1;
      protected guarded = 2;
      #mine = 3;
      static styles = css\`\`;
      /** @internal */
      wired = 1;
      /** Read only. */
      get value(): number { return 1; }
      set value(v: number) {}
      @property() set label2(v: string) {}
      accessor count: number = 0;
      method() {}
    }
  `).docs;

  test('only public instance fields and accessors', () => {
    expect(docs.properties.map((p) => p.name)).toEqual([
      'size',
      'big',
      'data',
      'label',
      'value',
      'label2',
      'count',
    ]);
  });

  test('types, defaults, descriptions and attributes', () => {
    const [size, big, data, label, value, label2, count] = docs.properties;
    expect(size).toEqual({
      name: 'size',
      description: 'The size.',
      type: "'small' | 'large'",
      default: "'small'",
      counterpart: 'size',
    });
    expect(big).toEqual({
      name: 'big',
      deprecated: 'Use size.',
      type: 'boolean',
      default: 'false',
      counterpart: 'is-big',
    });
    expect(data).toEqual({
      name: 'data',
      type: '{a: number} | null',
      default: 'null',
    });
    expect(label).toEqual({
      name: 'label',
      description: 'Plain field.',
      default: "'x'",
    });
    expect(value).toEqual({
      name: 'value',
      description: 'Read only.',
      type: 'number',
    });
    expect(label2).toEqual({
      name: 'label2',
      type: 'string',
      counterpart: 'label2',
    });
    expect(count).toEqual({name: 'count', type: 'number', default: '0'});
  });

  test('attributes mirror reactive properties', () => {
    expect(docs.attributes).toEqual([
      {
        name: 'size',
        description: 'The size.',
        type: "'small' | 'large'",
        default: "'small'",
        counterpart: 'size',
      },
      {
        name: 'is-big',
        deprecated: 'Use size.',
        type: 'boolean',
        default: 'false',
        counterpart: 'big',
      },
      {name: 'label2', type: 'string', counterpart: 'label2'},
    ]);
  });

  test('the default attribute lowercases the name', () => {
    const cls = only(`class X { @property() fullName = ''; }`);
    expect(cls.docs.attributes.map((a) => a.name)).toEqual(['fullname']);
  });
});

describe('JavaScript', () => {
  test('static properties and JSDoc types', () => {
    const cls = only(
      `
      /** A JS element. */
      export class XJs extends LitElement {
        static properties = {
          /** The name. */
          name: {type: String},
          open: {type: Boolean, attribute: 'is-open'},
          inner: {state: true},
          data: {attribute: false},
        };
        /** @type {number} */
        count = 0;
      }
      customElements.define('x-js', XJs);
    `,
      '/app/src/x-js.js'
    );
    expect(cls.tagName).toBe('x-js');
    expect(cls.docs.description).toBe('A JS element.');
    expect(cls.docs.properties).toEqual([
      {name: 'count', type: 'number', default: '0'},
      {
        name: 'name',
        description: 'The name.',
        type: 'string',
        counterpart: 'name',
      },
      {name: 'open', type: 'boolean', counterpart: 'is-open'},
      {name: 'data'},
    ]);
  });

  test('a field declared alongside static properties takes its options', () => {
    const cls = only(`
      class X extends LitElement {
        static get properties() { return {size: {attribute: 'sz'}}; }
        /** The size. */
        declare size: string;
      }
    `);
    expect(cls.docs.properties).toEqual([
      {
        name: 'size',
        description: 'The size.',
        type: 'string',
        counterpart: 'sz',
      },
    ]);
  });
});

test('a module that does not parse documents nothing', () => {
  expect(extractModuleDocs('class {', '/app/src/broken.ts')).toEqual({
    classes: [],
  });
});

test('the id query is ignored when picking the language', () => {
  const {classes} = extractModuleDocs(
    'class X { a: number = 1 }',
    '/app/src/x.ts?v=123'
  );
  expect(classes[0].docs.properties).toEqual([
    {name: 'a', type: 'number', default: '1'},
  ]);
});
