/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterEach, describe, expect, test} from 'vite-plus/test';
import {
  buildTree,
  collectDetails,
  isInspectable,
} from '../../lib/runtime/inspector/collect.js';

const SOURCE_META_KEY = Symbol.for('@lit-labs/vite-plugin-lit#source');

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

  test('tolerates elements without elementProperties', () => {
    const el = document.createElement('div');
    const details = collectDetails(el);
    expect(details.properties).toEqual([]);
    expect(details.flags.hasUpdated).toBe(false);
    expect(details.flags.hasShadowRoot).toBe(false);
  });
});
