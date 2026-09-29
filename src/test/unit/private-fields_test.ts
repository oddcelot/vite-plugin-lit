import {describe, expect, test} from 'vite-plus/test';
import {rewritePrivateNames} from '../../lib/plugins/private-fields.js';
import {syncOwnMembers} from '../../lib/runtime/patch.js';

const rewrite = (code: string, id = '/src/a.ts'): string => {
  const out = rewritePrivateNames(code, id);
  if (!out) {
    throw new Error('expected a rewrite');
  }
  return out.code;
};

/** Evaluates module-ish source (no imports) and returns the named binding. */
const evaluate = (code: string, name: string): any =>
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function(`${code}\nreturn ${name};`)();

const noKeys = (out: string) => out.replace(/Symbol\.for\(".*?"\)/g, '');

const KEY = '@oddsquad/vite-plugin-lit#private:/src/a.ts:';

describe('rewritePrivateNames', () => {
  test('returns null without a #, on parse errors, and with nothing to do', () => {
    expect(rewritePrivateNames('class A {}', 'a.js')).toBeNull();
    expect(rewritePrivateNames('class A { #x = ', 'a.js')).toBeNull();
    expect(rewritePrivateNames('const s = "#x"; // #y', 'a.js')).toBeNull();
  });

  test('rewrites fields and member access', () => {
    const out = rewrite('class A { #x = 1; get() { return this.#x; } }');
    expect(noKeys(out)).not.toMatch(/#x/);
    expect(out).toContain(`Symbol.for("${KEY}A#x")`);
    expect(out).toContain('[__litPriv0] = 1');
    expect(out).toContain('this[__litPriv0]');
  });

  test('rewrites methods, getters, setters and statics', () => {
    const out = rewrite(`class A {
      #m() { return 1; }
      get #g() { return 2; }
      set #g(v) {}
      static #s = 3;
      static #sm() { return A.#s; }
      run() { return this.#m() + this.#g + A.#sm(); }
    }`);
    expect(noKeys(out)).not.toMatch(/#[a-z]/);
    // #m, #g, #s, #sm share one symbol each (getter and setter share).
    expect(out.match(/Symbol\.for/g)).toHaveLength(4);
    const A = evaluate(out.replace('class A', 'const A = class A'), 'A');
    expect(new A().run()).toBe(1 + 2 + 3);
  });

  test('rewrites optional chaining and `#x in obj`', () => {
    const out = rewrite(
      'class A { #x = 1; f(o) { return o?.#x; } h(o) { return #x in o; } }'
    );
    expect(out).toContain('o?.[__litPriv0]');
    expect(out).toContain('__litPriv0 in o');
    const A = evaluate(out.replace('class A', 'const A = class A'), 'A');
    const a = new A();
    expect(a.f(a)).toBe(1);
    expect(a.f(null)).toBeUndefined();
    expect(a.h(a)).toBe(true);
    expect(a.h({})).toBe(false);
  });

  test('handles parenthesised objects and whitespace around the dot', () => {
    const out = rewrite('class A { #x = 1; f(o) { return (o)\n  .#x; } }');
    expect(noKeys(out)).not.toMatch(/#x/);
    expect(out).toContain('(o)\n  [__litPriv0]');
  });

  test('resolves nested classes to the innermost declaring class', () => {
    const out = rewrite(`class Outer {
      #x = 1;
      #y = 2;
      make() {
        return class Inner {
          #x = 10;
          sum(o) { return this.#x + o.#y; }
        };
      }
    }`);
    expect(out).toContain(`${KEY}Outer#x`);
    expect(out).toContain(`${KEY}Outer#y`);
    expect(out).toContain(`${KEY}Inner#x`);
    const Outer = evaluate(
      out.replace('class Outer', 'const Outer = class Outer'),
      'Outer'
    );
    const o = new Outer();
    const Inner = o.make();
    // Inner's #x is 10, Outer's #y is 2.
    expect(new Inner().sum(o)).toBe(12);
  });

  test('superclass expressions resolve outside the class body', () => {
    const out = rewrite(`class Outer {
      #x = 1;
      f() { return class extends (this.#x, Object) { #x = 2; }; }
    }`);
    // Both `#x` uses inside `f` before the inner body point at Outer.
    expect(out).toContain('(this[__litPriv0], Object)');
  });

  test('two classes with the same private name get different keys', () => {
    const out = rewrite('class A { #x = 1; }\nclass B { #x = 2; }');
    expect(out).toContain(`${KEY}A#x`);
    expect(out).toContain(`${KEY}B#x`);
  });

  test('duplicate class names are disambiguated in source order', () => {
    const out = rewrite(
      'const a = () => class Foo { #x = 1; };\nconst b = () => class Foo { #x = 2; };'
    );
    expect(out).toContain(`${KEY}Foo#x`);
    expect(out).toContain(`${KEY}Foo~1#x`);
  });

  test('class expressions take their key from the binding', () => {
    const out = rewrite(
      `const A = class { #x = 1; };
       let B; B = class { #x = 1; };
       export default class { #x = 1; }
       const C = (() => class { #x = 1; })();`
    );
    expect(out).toContain(`${KEY}A#x`);
    expect(out).toContain(`${KEY}B#x`);
    expect(out).toContain(`${KEY}default#x`);
    expect(out).toContain(`${KEY}anonymous#x`);
  });

  test('ignores the query string in the key and is deterministic', () => {
    const src = 'class A { #x = 1; f() { return this.#x; } }';
    const a = rewritePrivateNames(src, '/src/a.ts?t=1');
    const b = rewritePrivateNames(src, '/src/a.ts?t=2');
    expect(a?.code).toBe(b?.code);
    expect(a?.code).toContain(`${KEY}A#x`);
    expect(a?.map).toBeTruthy();
  });

  test('avoids identifier collisions with existing code', () => {
    const out = rewrite('const __litPriv0 = 1; class A { #x = __litPriv0; }');
    expect(out).toContain('__litPriv_0');
  });

  test('protects against ASI when a member relied on it', () => {
    const out = rewrite(
      'class A {\n  a = 1\n  #b = 2\n  c() { return this.#b }\n}'
    );
    const A = evaluate(out.replace('class A', 'const A = class A'), 'A');
    const a = new A();
    expect(a.a).toBe(1);
    expect(a.c()).toBe(2);
  });

  test('bails on undeclared private names and decorated private members', () => {
    expect(
      rewritePrivateNames('class A { f(o) { return o.#nope; } }', 'a.js')
    ).toBeNull();
    expect(rewritePrivateNames('class A { @dec #x = 1; }', 'a.js')).toBeNull();
  });
});

describe('hot patching a class with private members', () => {
  const source = `
    const Counter = class Counter {
      #count = 0;
      #bump() { this.#count++; }
      inc() { this.#bump(); return this.#count; }
    };
  `;
  const patched = source.replace('this.#count;', 'this.#count * 10;');

  const patch = (OldClass: any, NewClass: any) => {
    syncOwnMembers(OldClass.prototype, NewClass.prototype, ['constructor']);
    syncOwnMembers(OldClass, NewClass, ['prototype', 'name', 'length']);
  };

  test('without the rewrite the old instance breaks (control)', () => {
    const OldClass = evaluate(source, 'Counter');
    const NewClass = evaluate(patched, 'Counter');
    const old = new OldClass();
    expect(old.inc()).toBe(1);
    patch(OldClass, NewClass);
    expect(() => old.inc()).toThrow(TypeError);
  });

  test('with the rewrite the old instance keeps working and keeps state', () => {
    const OldClass = evaluate(rewrite(source), 'Counter');
    const NewClass = evaluate(rewrite(patched), 'Counter');
    expect(OldClass).not.toBe(NewClass);
    const old = new OldClass();
    expect(old.inc()).toBe(1);
    expect(old.inc()).toBe(2);
    patch(OldClass, NewClass);
    // New method body (`* 10`) runs against the preserved count (2 -> 3).
    expect(old.inc()).toBe(30);
    expect(new OldClass().inc()).toBe(10);
  });
});
