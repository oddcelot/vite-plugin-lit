import {LitElement, type PropertyDeclarations} from 'lit';
import {afterEach, describe, expect, test} from 'vite-plus/test';
import {
  buildTree,
  collectDetails,
  isForeignElement,
  isInspectable,
  isUndefinedElement,
} from '../../lib/runtime/inspector/collect.js';
import {
  defineIdOf,
  rememberDefineFrames,
} from '../../lib/runtime/define-sites.js';

const SOURCE_META_KEY = Symbol.for('@oddsquad/vite-plugin-lit#source');

let counter = 0;
const uniqueTag = (prefix: string) => `${prefix}-${counter++}`;

/** Defines a ReactiveElement look-alike; returns its tag name. */
const define = (
  opts: {
    props?: Array<[string, Record<string, unknown>]>;
    meta?: {filePath: string; lineNumber: number; componentName: string};
    shadow?: boolean;
    tag?: string;
  } = {}
): string => {
  const tag = opts.tag ?? uniqueTag('x-comp');
  class El extends HTMLElement {
    static elementProperties = new Map<PropertyKey, unknown>(opts.props ?? []);
    hasUpdated = false;
    isUpdatePending = false;
    requestUpdate() {}
    constructor() {
      super();
      if (opts.shadow) this.attachShadow({mode: 'open'});
    }
  }
  if (opts.meta) {
    (El as unknown as Record<symbol, unknown>)[SOURCE_META_KEY] = opts.meta;
  }
  customElements.define(tag, El);
  return tag;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isInspectable', () => {
  test('accepts an upgraded element with requestUpdate', () => {
    const el = document.createElement(define());
    expect(isInspectable(el)).toBe(true);
  });

  test('rejects plain elements and non-upgraded custom tags', () => {
    expect(isInspectable(document.createElement('div'))).toBe(false);
    expect(isInspectable(document.createElement('never-defined'))).toBe(false);
  });

  test('rejects devtools own elements', () => {
    const overlay = document.createElement(define({tag: 'lit-source-overlay'}));
    const panel = document.createElement(define({tag: 'lit-devtools-thing'}));
    expect(isInspectable(overlay)).toBe(false);
    expect(isInspectable(panel)).toBe(false);
  });
});

describe('buildTree', () => {
  test('is empty for a body with no components', () => {
    document.body.innerHTML = '<div><span></span></div>';
    expect(buildTree()).toEqual([]);
  });

  test('nests components and flattens non-component wrappers', () => {
    const outer = define({
      shadow: true,
      meta: {filePath: '/a.ts', lineNumber: 3, componentName: 'Outer'},
    });
    const inner = define();
    const outerEl = document.createElement(outer);
    const wrapper = document.createElement('div');
    const innerEl = document.createElement(inner);
    wrapper.append(innerEl);
    outerEl.shadowRoot!.append(wrapper);
    document.body.append(outerEl);

    const tree = buildTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      tagName: outer,
      componentName: 'Outer',
      source: {file: '/a.ts', line: 3},
    });
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]).toMatchObject({
      tagName: inner,
      componentName: undefined,
      source: undefined,
      children: [],
    });
  });

  test('tree nodes carry their call site', () => {
    const el = document.createElement(define());
    el.setAttribute('data-lit-source', 'src/app.ts:5:3');
    document.body.append(el);
    expect(buildTree()[0]!.callSite).toEqual({
      file: 'src/app.ts',
      line: 5,
      column: 3,
    });
  });

  test('includes light-DOM children and gives distinct stable ids', () => {
    const tag = define();
    const a = document.createElement(tag);
    const b = document.createElement(tag);
    a.append(b);
    document.body.append(a);

    const first = buildTree();
    const second = buildTree();
    expect(first[0]!.children[0]!.tagName).toBe(tag);
    expect(first[0]!.id).not.toBe(first[0]!.children[0]!.id);
    expect(second[0]!.id).toBe(first[0]!.id);
  });

  test('skips devtools elements but keeps components below them', () => {
    const overlayTag = define({tag: 'lit-devtools-host'});
    const inner = define();
    const host = document.createElement(overlayTag);
    host.append(document.createElement(inner));
    document.body.append(host);
    const tree = buildTree();
    expect(tree.map((n) => n.tagName)).toEqual([inner]);
  });
});

describe('undefined elements', () => {
  test('flags a custom tag nothing defines, not plain or defined ones', () => {
    expect(isUndefinedElement(document.createElement('never-defined'))).toBe(
      true
    );
    expect(isUndefinedElement(document.createElement('div'))).toBe(false);
    expect(isUndefinedElement(document.createElement(define()))).toBe(false);
    expect(isUndefinedElement(document.createElement('lit-devtools-x'))).toBe(
      false
    );
  });

  test('keeps it in place, with its call site and light children', () => {
    const outer = document.createElement(define({shadow: true}));
    const missing = document.createElement('missing-thing');
    missing.setAttribute('data-lit-source', 'src/app.ts:8:5');
    const inner = define();
    missing.append(document.createElement(inner));
    outer.shadowRoot!.append(missing);
    document.body.append(outer);

    const [root] = buildTree();
    expect(root!.notDefined).toBeUndefined();
    const [node] = root!.children;
    expect(node).toMatchObject({
      tagName: 'missing-thing',
      notDefined: true,
      callSite: {file: 'src/app.ts', line: 8, column: 5},
    });
    expect(node!.children.map((c) => c.tagName)).toEqual([inner]);
  });

  test('reports each undefined tag to the caller, and drops it once defined', async () => {
    const tag = uniqueTag('late-comp');
    document.body.append(document.createElement(tag));
    const heard: string[] = [];
    expect(buildTree((t) => heard.push(t))[0]!.notDefined).toBe(true);
    expect(heard).toEqual([tag]);

    define({tag});
    await customElements.whenDefined(tag);
    const [node] = buildTree();
    expect(node!.notDefined).toBeUndefined();
  });

  test('details of one say so, with no Lit state', () => {
    const el = document.createElement('missing-thing');
    el.setAttribute('data-lit-source', 'src/app.ts:8:5');
    document.body.append(el);
    const d = collectDetails(el);
    expect(d).toMatchObject({
      tagName: 'missing-thing',
      notDefined: true,
      callSite: {file: 'src/app.ts', line: 8},
      properties: [],
    });
    expect(d.source).toBeUndefined();
  });
});

/** Defines a custom element with no Lit look-alike API; returns its tag. */
const defineForeign = (shadow = false): string => {
  const tag = uniqueTag('plain-el');
  customElements.define(
    tag,
    class extends HTMLElement {
      constructor() {
        super();
        if (shadow) this.attachShadow({mode: 'open'});
      }
    }
  );
  return tag;
};

describe('custom elements other libraries define', () => {
  test('flags a defined non-Lit element, not Lit, undefined or plain ones', () => {
    expect(isForeignElement(document.createElement(defineForeign()))).toBe(
      true
    );
    expect(isForeignElement(document.createElement(define()))).toBe(false);
    expect(isForeignElement(document.createElement('never-defined'))).toBe(
      false
    );
    expect(isForeignElement(document.createElement('div'))).toBe(false);
  });

  test("leaves out the DevTools hub's dock", () => {
    customElements.define('devframes-dock-test', class extends HTMLElement {});
    expect(
      isForeignElement(document.createElement('devframes-dock-test'))
    ).toBe(false);
  });

  test('keeps it in place, with the components in its shadow and light DOM', () => {
    const outer = document.createElement(defineForeign(true));
    const inShadow = define();
    const inLight = define();
    outer.shadowRoot!.append(document.createElement(inShadow));
    outer.append(document.createElement(inLight));
    outer.setAttribute('data-lit-source', 'src/app.ts:3:1');
    document.body.append(outer);

    const [node] = buildTree();
    expect(node).toMatchObject({
      tagName: outer.localName,
      notLit: true,
      callSite: {file: 'src/app.ts', line: 3, column: 1},
    });
    expect(node!.notDefined).toBeUndefined();
    expect(node!.children.map((c) => c.tagName)).toEqual([inShadow, inLight]);
  });

  test('a Lit node is not flagged', () => {
    document.body.append(document.createElement(define()));
    expect(buildTree()[0]!.notLit).toBeUndefined();
  });

  test('details of one say so, with attributes but no properties', () => {
    const el = document.createElement(defineForeign());
    el.setAttribute('variant', 'brand');
    document.body.append(el);
    const d = collectDetails(el);
    expect(d).toMatchObject({
      notLit: true,
      attributes: [{name: 'variant', value: 'brand'}],
      properties: [],
    });
    expect(d.notDefined).toBeUndefined();
  });
});

describe('collectDetails', () => {
  test('reports identity, source, attributes, and flags', () => {
    const tag = define({
      shadow: true,
      meta: {filePath: '/b.ts', lineNumber: 9, componentName: 'Bee'},
    });
    const el = document.createElement(tag) as HTMLElement & {
      hasUpdated: boolean;
    };
    el.setAttribute('foo', 'bar');
    el.hasUpdated = true;
    const details = collectDetails(el);
    expect(details).toMatchObject({
      tagName: tag,
      componentName: 'Bee',
      source: {file: '/b.ts', line: 9},
      attributes: [{name: 'foo', value: 'bar'}],
      properties: [],
      flags: {hasUpdated: true, isUpdatePending: false, hasShadowRoot: true},
    });
  });

  test('reads the call site and keeps the stamp out of the attributes', () => {
    const el = document.createElement(define());
    el.setAttribute('data-lit-source', 'src/app.ts:12:7');
    el.setAttribute('foo', 'bar');
    const details = collectDetails(el);
    expect(details.callSite).toEqual({file: 'src/app.ts', line: 12, column: 7});
    expect(details.attributes).toEqual([{name: 'foo', value: 'bar'}]);
  });

  test('parses a call site from the right, so drive letters survive', () => {
    const el = document.createElement(define());
    el.setAttribute('data-lit-source', 'C:/proj/src/app.ts:3:14');
    expect(collectDetails(el).callSite).toEqual({
      file: 'C:/proj/src/app.ts',
      line: 3,
      column: 14,
    });
  });

  test('carries the define frames only for an unstamped class that has them', () => {
    const frames = [{url: 'https://app.test/a.js', line: 3, column: 14}];
    const bare = document.createElement(define());
    expect(collectDetails(bare).defineFrames).toBeUndefined();
    rememberDefineFrames(bare.constructor, frames);
    expect(collectDetails(bare).defineFrames).toEqual(frames);

    const stamped = document.createElement(
      define({meta: {filePath: '/c.ts', lineNumber: 2, componentName: 'Cee'}})
    );
    rememberDefineFrames(stamped.constructor, frames);
    expect(collectDetails(stamped).defineFrames).toBeUndefined();
    expect(collectDetails(stamped).source).toEqual({file: '/c.ts', line: 2});
  });

  test('tree nodes carry the define id only for an unstamped class that has frames', () => {
    const frames = [{url: 'https://app.test/a.js', line: 3, column: 14}];
    const bareTag = define();
    const bare = document.createElement(bareTag);
    const stamped = document.createElement(
      define({meta: {filePath: '/c.ts', lineNumber: 2, componentName: 'Cee'}})
    );
    document.body.append(bare, stamped);
    const before = buildTree();
    expect(before.map((n) => n.defineId)).toEqual([undefined, undefined]);
    rememberDefineFrames(bare.constructor, frames);
    rememberDefineFrames(stamped.constructor, frames);
    const [bareNode, stampedNode] = buildTree();
    expect(bareNode!.defineId).toBe(defineIdOf(bare.constructor));
    expect(bareNode).toHaveProperty('defineId');
    expect(stampedNode).not.toHaveProperty('defineId');
  });

  test('a missing or malformed call site is absent', () => {
    const el = document.createElement(define());
    expect(collectDetails(el).callSite).toBeUndefined();
    el.setAttribute('data-lit-source', 'nonsense');
    expect(collectDetails(el).callSite).toBeUndefined();
  });

  test('describes declared properties', () => {
    const tag = define({
      props: [
        ['count', {}],
        ['myLabel', {attribute: 'my-label', reflect: true}],
        ['internal', {state: true, attribute: false}],
      ],
    });
    const el = document.createElement(tag) as HTMLElement &
      Record<string, unknown>;
    el.count = 4;
    el.myLabel = 'hi';
    el.internal = {a: 1};
    const props = collectDetails(el).properties;
    expect(props.map((p) => p.name)).toEqual(['count', 'myLabel', 'internal']);
    expect(props[0]).toMatchObject({
      attribute: 'count',
      reflects: false,
      state: false,
    });
    expect(props[1]).toMatchObject({attribute: 'my-label', reflects: true});
    expect(props[2]).toMatchObject({attribute: false, state: true});
  });

  test('lists declaration options beyond Lit defaults, by presence', () => {
    const tag = uniqueTag('x-opts');
    class Opts extends LitElement {
      static override properties: PropertyDeclarations = {
        plain: {},
        changed: {hasChanged: () => true},
        converted: {converter: {fromAttribute: (v: string) => v}},
        manual: {noAccessor: true},
        seeded: {useDefault: true},
        quiet: {attribute: false},
        all: {
          hasChanged: () => false,
          converter: {toAttribute: (v: unknown) => String(v)},
          noAccessor: true,
          useDefault: true,
        },
      };
    }
    customElements.define(tag, Opts);
    const props = collectDetails(document.createElement(tag)).properties;
    const options = Object.fromEntries(props.map((p) => [p.name, p.options]));
    expect(options).toEqual({
      plain: undefined,
      changed: ['hasChanged'],
      converted: ['converter'],
      manual: ['noAccessor'],
      seeded: ['useDefault'],
      quiet: undefined,
      all: ['hasChanged', 'converter', 'noAccessor', 'useDefault'],
    });
    expect(props.find((p) => p.name === 'quiet')?.attribute).toBe(false);
  });

  test('a throwing getter is reported without failing the snapshot', () => {
    const tag = define({
      props: [
        ['bad', {}],
        ['good', {}],
      ],
    });
    const el = document.createElement(tag);
    Object.defineProperty(el, 'bad', {
      get() {
        throw new Error('boom');
      },
    });
    (el as unknown as Record<string, unknown>).good = 1;
    const props = collectDetails(el).properties;
    expect(props[0]).toMatchObject({
      name: 'bad',
      value: '[getter threw]',
      type: 'error',
    });
    expect(props[1]!.name).toBe('good');
    expect(props[1]!.type).not.toBe('error');
  });

  test('includes extras only when the element has instance state', () => {
    const plain = collectDetails(document.createElement(define()));
    expect('extras' in plain).toBe(false);

    const el = document.createElement(define());
    (el as unknown as Record<string, unknown>).counter = 2;
    expect(collectDetails(el).extras).toEqual([
      {kind: 'field', name: 'counter', value: '2', type: 'number'},
    ]);
  });

  test('tolerates elements without elementProperties', () => {
    const el = document.createElement('div');
    const details = collectDetails(el);
    expect(details.properties).toEqual([]);
    expect(details.flags.hasUpdated).toBe(false);
    expect(details.flags.hasShadowRoot).toBe(false);
  });
});

describe('collectDetails warnings', () => {
  const STATE = Symbol.for('@oddsquad/vite-plugin-lit#lit-warnings');

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[STATE];
    delete (globalThis as {litIssuedWarnings?: unknown}).litIssuedWarnings;
  });

  test('lists Lit warnings naming the tag, and omits the field otherwise', async () => {
    const tag = define();
    const el = document.createElement(tag);
    const {installLitWarningCapture} =
      await import('../../lib/runtime/timeline/lit-warnings.js');
    installLitWarningCapture();
    expect(collectDetails(el).warnings).toBeUndefined();

    (
      globalThis as unknown as {litIssuedWarnings: Set<string>}
    ).litIssuedWarnings.add(
      `Element ${tag} scheduled an update. See https://lit.dev/msg/change-in-update for more information.`
    );
    expect(collectDetails(el).warnings).toEqual([
      {
        code: 'change-in-update',
        message: `Element ${tag} scheduled an update.`,
      },
    ]);
  });

  test('tree nodes carry a warning count, omitted when zero', async () => {
    const tag = define();
    const quiet = define();
    document.body.append(
      document.createElement(tag),
      document.createElement(quiet)
    );
    const {installLitWarningCapture} =
      await import('../../lib/runtime/timeline/lit-warnings.js');
    installLitWarningCapture();
    (
      globalThis as unknown as {litIssuedWarnings: Set<string>}
    ).litIssuedWarnings.add(
      `Element ${tag} scheduled an update. See https://lit.dev/msg/change-in-update for more information.`
    );
    const nodes = buildTree();
    expect(nodes.find((n) => n.tagName === tag)!.warnings).toBe(1);
    expect(nodes.find((n) => n.tagName === quiet)).not.toHaveProperty(
      'warnings'
    );
    document.body.replaceChildren();
  });
});
