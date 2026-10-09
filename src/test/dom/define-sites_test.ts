import {describe, expect, test} from 'vite-plus/test';
import {
  defineFramesById,
  defineFramesOf,
  defineIdOf,
  installDefineSites,
  rememberDefineFrames,
} from '../../lib/runtime/define-sites.js';

let counter = 0;
const uniqueTag = () => `define-site-${counter++}`;

describe('installDefineSites', () => {
  test('chains with a define wrapped before and after it, once', () => {
    const seen: string[] = [];
    const before = customElements.define.bind(customElements);
    customElements.define = (name, ctor, options) => {
      seen.push(`inner:${name}`);
      before(name, ctor, options);
    };
    installDefineSites();
    installDefineSites();
    const ours = customElements.define.bind(customElements);
    customElements.define = (name, ctor, options) => {
      seen.push(`outer:${name}`);
      ours(name, ctor, options);
    };
    const tag = uniqueTag();
    class El extends HTMLElement {}
    customElements.define(tag, El);
    expect(seen).toEqual([`outer:${tag}`, `inner:${tag}`]);
    expect(customElements.get(tag)).toBe(El);
  });

  test('records only http(s) frames, so a test file stack leaves none', () => {
    installDefineSites();
    class El extends HTMLElement {}
    customElements.define(uniqueTag(), El);
    expect(defineFramesOf(El)).toBeUndefined();
  });
});

describe('rememberDefineFrames', () => {
  test('keeps non-empty frames per constructor', () => {
    class A {}
    class B {}
    rememberDefineFrames(A, [{url: 'https://a.test/x.js', line: 1, column: 2}]);
    rememberDefineFrames(B, []);
    expect(defineFramesOf(A)).toEqual([
      {url: 'https://a.test/x.js', line: 1, column: 2},
    ]);
    expect(defineFramesOf(B)).toBeUndefined();
  });
});

describe('defineIdOf', () => {
  test('numbers each recorded constructor once and maps the id back', () => {
    class A {}
    class B {}
    class None {}
    const framesA = [{url: 'https://a.test/x.js', line: 1, column: 2}];
    rememberDefineFrames(A, framesA);
    rememberDefineFrames(B, [{url: 'https://a.test/y.js', line: 3, column: 4}]);
    rememberDefineFrames(None, []);
    const a = defineIdOf(A)!;
    expect(typeof a).toBe('number');
    expect(defineIdOf(B)).not.toBe(a);
    expect(defineIdOf(None)).toBeUndefined();
    expect(defineFramesById(a)).toEqual(framesA);
    // Recording again keeps the id.
    rememberDefineFrames(A, framesA);
    expect(defineIdOf(A)).toBe(a);
    expect(defineFramesById(-1)).toBeUndefined();
  });
});
