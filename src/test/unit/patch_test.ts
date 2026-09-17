/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test';
import {
  install,
  syncOwnMembers,
  type PatchOptions,
} from '../../lib/runtime/patch.js';
import {HMR_INCOMPATIBLE_CHANNEL} from '../../types/hmr-incompatibility.js';

/**
 * Characterization harness.
 *
 * `patch.ts` exports only `syncOwnMembers` and `install`; everything else is
 * module-private by design. These fakes drive the private code through
 * `install()` alone: a stand-in `customElements` registry, plain classes in
 * place of real custom elements (the patcher only ever touches prototypes and
 * property descriptors), and manual lifecycle invocation to register
 * "live instances".
 */

/** Same key `patch.ts` pins its singleton state under. */
const STATE_KEY = Symbol.for('@lit-labs/vite-plugin-lit#patch');

interface ElementCtor {
  new (): FakeElement;
  prototype: FakeElement;
}

/** Minimal `CustomElementRegistry`: the interceptor needs `define` + `get`. */
class FakeRegistry {
  readonly defined = new Map<string, ElementCtor>();
  /** How many defines reached the "platform" rather than being intercepted. */
  defineCalls = 0;

  define(name: string, ctor: ElementCtor): void {
    this.defineCalls++;
    this.defined.set(name, ctor);
  }

  get(name: string): ElementCtor | undefined {
    return this.defined.get(name);
  }
}

/** Stands in for ReactiveElement: only `requestUpdate` is duck-typed. */
class FakeElement {
  connects = 0;
  disconnects = 0;
  updates = 0;

  requestUpdate(): void {
    this.updates++;
  }
}

let registry: FakeRegistry;

/**
 * Drops the state singleton and the fake registry, then installs fresh.
 * Without the delete, `install()` short-circuits on every call after the
 * first and the next test would run against the previous test's state.
 */
const installFresh = (options: PatchOptions = {}): FakeRegistry => {
  delete (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY];
  registry = new FakeRegistry();
  (globalThis as {customElements?: unknown}).customElements = registry;
  install({onIncompatible: 'warn', ...options});
  return registry;
};

const define = (tag: string, ctor: ElementCtor): void => {
  customElements.define(tag, ctor as unknown as CustomElementConstructor);
};

/**
 * Injects a fake `HotChannel` directly onto the live `PatchState` singleton
 * (the same well-known symbol `installFresh` above already manipulates), so
 * a test can assert on `.send()` calls without a real `import.meta.hot` —
 * Vitest's `node` environment never provides one.
 */
const stubHotChannel = (): {send: ReturnType<typeof vi.fn>} => {
  const send = vi.fn();
  const state = (
    globalThis as unknown as Record<symbol, {hot?: {send: typeof send}}>
  )[STATE_KEY]!;
  state.hot = {send};
  return {send};
};

/** The class the registry actually holds — the patcher's canonical class. */
const canonicalOf = (tag: string): ElementCtor =>
  customElements.get(tag) as unknown as ElementCtor;

/** Reads a (possibly instrumented) lifecycle method off a prototype. */
const lifecycleOf = (
  ctor: ElementCtor,
  name: 'connectedCallback' | 'disconnectedCallback'
): ((this: FakeElement) => void) =>
  (ctor.prototype as unknown as Record<string, (this: FakeElement) => void>)[
    name
  ];

/** Registers `el` as a live instance of `tag`, as the platform would. */
const connect = (tag: string, el: FakeElement): void => {
  lifecycleOf(canonicalOf(tag), 'connectedCallback').call(el);
};

const disconnect = (tag: string, el: FakeElement): void => {
  lifecycleOf(canonicalOf(tag), 'disconnectedCallback').call(el);
};

/** Casts away the `unknown`-ness of a patched class's synced statics. */
const staticsOf = (ctor: ElementCtor): Record<PropertyKey, unknown> =>
  ctor as unknown as Record<PropertyKey, unknown>;

const protoOf = (ctor: ElementCtor): Record<PropertyKey, unknown> =>
  ctor.prototype as unknown as Record<PropertyKey, unknown>;

beforeEach(() => {
  installFresh();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as {customElements?: unknown}).customElements;
  delete (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY];
});

describe('syncOwnMembers', () => {
  test('copies new members', () => {
    const target = {};
    const source = {a: 1, greet() {}};
    syncOwnMembers(target, source, []);
    expect((target as {a: number}).a).toBe(1);
    expect(typeof (target as {greet: unknown}).greet).toBe('function');
  });

  test('deletes vanished members', () => {
    const target = {old: 1, keep: 2};
    const source = {keep: 3};
    syncOwnMembers(target, source, []);
    expect('old' in target).toBe(false);
    expect((target as {keep: number}).keep).toBe(3);
  });

  test('replaces existing values', () => {
    const target = {x: 1};
    const source = {x: 2};
    syncOwnMembers(target, source, []);
    expect((target as {x: number}).x).toBe(2);
  });

  test('honors the skip list', () => {
    const target = {constructor: 'orig', gone: 1} as object;
    const source = {};
    syncOwnMembers(target, source, ['constructor']);
    expect((target as {constructor: unknown}).constructor).toBe('orig');
    expect('gone' in target).toBe(false);
  });

  test('copies accessor descriptors as accessors', () => {
    const source = {};
    const backing = 41;
    Object.defineProperty(source, 'val', {
      get: () => backing + 1,
      configurable: true,
      enumerable: true,
    });
    const target: Record<string, unknown> = {};
    syncOwnMembers(target, source, []);
    const desc = Object.getOwnPropertyDescriptor(target, 'val')!;
    expect(typeof desc.get).toBe('function');
    expect((target as {val: number}).val).toBe(42);
  });

  test('handles symbol-keyed members', () => {
    const S = Symbol('s');
    const source = {[S]: 'hi'};
    const target = {};
    syncOwnMembers(target, source, []);
    expect((target as {[key: symbol]: unknown})[S]).toBe('hi');
  });

  test('leaves a non-configurable vanished key in place without throwing', () => {
    const target = {};
    Object.defineProperty(target, 'locked', {
      value: 1,
      configurable: false,
      enumerable: true,
    });
    const source = {};
    expect(() => syncOwnMembers(target, source, [])).not.toThrow();
    expect((target as {locked: number}).locked).toBe(1);
  });
});

describe('install / define interceptor', () => {
  test('a first define reaches the platform and is instrumented', () => {
    class XA extends FakeElement {}
    define('x-a', XA);
    expect(registry.get('x-a')).toBe(XA);
    expect(registry.defineCalls).toBe(1);
    // `instrument` replaced the (inherited/absent) lifecycle hooks with own
    // branded wrappers on the prototype.
    expect(
      Object.getOwnPropertyDescriptor(XA.prototype, 'connectedCallback')
    ).toBeDefined();
    expect(
      Object.getOwnPropertyDescriptor(XA.prototype, 'disconnectedCallback')
    ).toBeDefined();
  });

  test('re-defining the identical class object is a no-op', () => {
    class XB extends FakeElement {}
    define('x-b', XB);
    expect(() => {
      define('x-b', XB);
    }).not.toThrow();
    expect(registry.defineCalls).toBe(1);
  });

  test('a second, different class never reaches the platform', () => {
    class XC1 extends FakeElement {}
    class XC2 extends FakeElement {}
    define('x-c', XC1);
    define('x-c', XC2);
    // The tag keeps its original constructor; the new class is only a
    // donor of members.
    expect(registry.get('x-c')).toBe(XC1);
    expect(registry.defineCalls).toBe(1);
  });

  test('a tag defined before install() is adopted as canonical', () => {
    class XD1 extends FakeElement {
      old(): string {
        return 'old';
      }
    }
    class XD2 extends FakeElement {
      fresh(): string {
        return 'fresh';
      }
    }
    // Bypass the interceptor to simulate a define that happened first.
    registry.defined.set('x-d', XD1);
    define('x-d', XD2);
    expect(canonicalOf('x-d')).toBe(XD1);
    expect(protoOf(XD1)['fresh']).toBeTypeOf('function');
  });

  test('a second install() does not re-wrap customElements.define', () => {
    const before = Object.getOwnPropertyDescriptor(customElements, 'define')
      ?.value as unknown;
    install({reconnect: true});
    const after = Object.getOwnPropertyDescriptor(customElements, 'define')
      ?.value as unknown;
    expect(after).toBe(before);
  });

  test('a second install() updates explicitly-provided options', () => {
    // `reconnect` is observable: it cycles the lifecycle hooks on every live
    // instance during a patch.
    class XE1 extends FakeElement {}
    class XE2 extends FakeElement {
      connectedCallback(): void {
        this.connects++;
      }
      disconnectedCallback(): void {
        this.disconnects++;
      }
    }
    install({reconnect: true});
    define('x-e', XE1);
    const el = new XE1();
    connect('x-e', el);
    define('x-e', XE2);
    expect(el.disconnects).toBe(1);
    expect(el.connects).toBe(1);
  });
});

describe('instance tracking', () => {
  test('connectedCallback tracks the instance and calls through', () => {
    class XF extends FakeElement {
      connectedCallback(): void {
        this.connects++;
      }
    }
    define('x-f', XF);
    const el = new XF();
    connect('x-f', el);
    expect(el.connects).toBe(1);
    // Tracked: a patch reaches it and asks it to re-render.
    define('x-f', class extends FakeElement {});
    expect(el.updates).toBe(1);
  });

  test('disconnectedCallback untracks the instance and calls through', () => {
    class XG extends FakeElement {
      disconnectedCallback(): void {
        this.disconnects++;
      }
    }
    define('x-g', XG);
    const el = new XG();
    connect('x-g', el);
    disconnect('x-g', el);
    expect(el.disconnects).toBe(1);
    // No longer tracked: the patch skips it entirely.
    define('x-g', class extends FakeElement {});
    expect(el.updates).toBe(0);
  });

  test('an instance re-attached after a missed patch catches up', () => {
    class XH extends FakeElement {}
    define('x-h', XH);
    const el = new XH();
    connect('x-h', el);
    disconnect('x-h', el);
    define('x-h', class extends FakeElement {});
    expect(el.updates).toBe(0);
    connect('x-h', el);
    // Its generation stamp lagged the record's, so it re-renders on attach.
    expect(el.updates).toBe(1);
  });
});

describe('hotPatch', () => {
  test('prototype methods are replaced without changing class identity', () => {
    class XI1 extends FakeElement {
      label(): string {
        return 'v1';
      }
    }
    class XI2 extends FakeElement {
      label(): string {
        return 'v2';
      }
    }
    define('x-i', XI1);
    const el = new XI1();
    connect('x-i', el);
    define('x-i', XI2);
    expect(el.label()).toBe('v2');
    expect(canonicalOf('x-i')).toBe(XI1);
  });

  test('prototype members that vanished are removed', () => {
    class XJ1 extends FakeElement {
      gone(): string {
        return 'gone';
      }
    }
    class XJ2 extends FakeElement {}
    define('x-j', XJ1);
    define('x-j', XJ2);
    expect('gone' in XJ1.prototype).toBe(false);
  });

  test('statics are synced without clobbering prototype/name/length', () => {
    class XK1 extends FakeElement {}
    class XK2 extends FakeElement {
      static readonly version = 2;
    }
    define('x-k', XK1);
    const proto = XK1.prototype;
    define('x-k', XK2);
    expect(staticsOf(XK1)['version']).toBe(2);
    expect(XK1.prototype).toBe(proto);
    expect(XK1.name).toBe('XK1');
    expect(XK1.length).toBe(0);
  });

  test('finalize() is called on the new class', () => {
    const finalize = vi.fn();
    class XL1 extends FakeElement {}
    class XL2 extends FakeElement {
      static readonly finalize = finalize;
    }
    define('x-l', XL1);
    define('x-l', XL2);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('reactive property values survive the accessor swap', () => {
    const OLD_SLOT = Symbol('count v1');
    const NEW_SLOT = Symbol('count v2');
    class XM1 extends FakeElement {
      static readonly elementProperties = new Map<PropertyKey, unknown>([
        ['count', {}],
      ]);
      [OLD_SLOT] = 0;
      get count(): number {
        return this[OLD_SLOT];
      }
      set count(value: number) {
        this[OLD_SLOT] = value;
      }
    }
    class XM2 extends FakeElement {
      static readonly elementProperties = new Map<PropertyKey, unknown>([
        ['count', {}],
      ]);
      [NEW_SLOT] = 0;
      get count(): number {
        return this[NEW_SLOT];
      }
      set count(value: number) {
        this[NEW_SLOT] = value;
      }
    }
    define('x-m', XM1);
    const el = new XM1();
    connect('x-m', el);
    el.count = 5;
    define('x-m', XM2);
    // Snapshotted through the old accessor, restored through the new one —
    // which reads a differently-keyed slot, as prod lit's per-evaluation
    // Symbol() storage keys do.
    expect(el.count).toBe(5);
    expect((el as unknown as Record<symbol, unknown>)[NEW_SLOT]).toBe(5);
  });

  test('instanceof against the new class matches canonical instances', () => {
    class XN1 extends FakeElement {}
    class XN2 extends FakeElement {}
    define('x-n', XN1);
    const el = new XN1();
    connect('x-n', el);
    define('x-n', XN2);
    expect(el instanceof XN2).toBe(true);
    expect({} instanceof XN2).toBe(false);
  });

  test('a standard-decorator class bails out instead of patching', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {send} = stubHotChannel();
    // Node has no Symbol.metadata, and litPropertyMetadata is a lit internal;
    // recreate both in the exact shape `usesStandardDecorators` reads.
    const metadataKey = Symbol('Symbol.metadata');
    Object.defineProperty(Symbol, 'metadata', {
      value: metadataKey,
      configurable: true,
    });
    const litGlobal = globalThis as {
      litPropertyMetadata?: WeakMap<object, Map<unknown, unknown>>;
    };
    litGlobal.litPropertyMetadata = new WeakMap();
    try {
      class XO1 extends FakeElement {
        label(): string {
          return 'v1';
        }
      }
      class XO2 extends FakeElement {
        label(): string {
          return 'v2';
        }
      }
      const metadata = {};
      Object.defineProperty(XO2, metadataKey, {value: metadata});
      litGlobal.litPropertyMetadata.set(metadata, new Map([['count', {}]]));

      define('x-o', XO1);
      define('x-o', XO2);

      expect(XO1.prototype.label()).toBe('v1');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        'standard accessor decorators'
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).toBe(HMR_INCOMPATIBLE_CHANNEL);
      const event = send.mock.calls[0]?.[1] as {
        tagName: string;
        reason: {code: string};
        action: string;
      };
      expect(event.tagName).toBe('x-o');
      expect(event.reason.code).toBe('accessor-decorators');
      expect(event.action).toBe('warn');
    } finally {
      delete (Symbol as {metadata?: symbol}).metadata;
      delete litGlobal.litPropertyMetadata;
    }
  });
});
