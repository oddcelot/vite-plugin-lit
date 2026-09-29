/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vite-plus/test';
import {
  createChildState,
  isReuseSafe,
  partsAround,
  PRIVATE_KEY_PREFIX,
  privateKeys,
  templateDrivenKeys,
  transferState,
  type ChildStateMode,
  type ElementLike,
  type PartLike,
} from '../../lib/runtime/child-state.js';

/**
 * Just enough of a DOM tree for the window: parent links, roots, `contains`,
 * attributes. The module duck-types everything, so plain objects do.
 */
class FakeNode {
  nodeType = 1;
  parentNode: FakeNode | null = null;
  /** Set on fake shadow roots. */
  host?: FakeNode;
  [key: string]: unknown;

  append(...nodes: FakeNode[]): this {
    for (const n of nodes) {
      n.parentNode = this;
    }
    return this;
  }

  getRootNode(): FakeNode {
    return this.parentNode === null ? this : this.parentNode.getRootNode();
  }

  contains(other: FakeNode | null): boolean {
    for (let n = other; n !== null; n = n.parentNode) {
      if (n === this) {
        return true;
      }
    }
    return false;
  }
}

class FakeElement extends FakeNode {
  static elementProperties = new Map<PropertyKey, {attribute?: unknown}>([
    ['count', {}],
    ['label', {}],
    ['fooBar', {attribute: 'foo-bar'}],
    ['secret', {attribute: false}],
  ]);

  count = 0;
  label = 'default';
  fooBar = 0;
  secret = 0;
  hasUpdated = false;
  renderRoot?: FakeNode;
  attributes: Array<{name: string; value: string}> = [];

  constructor(public localName = 'x-item') {
    super();
  }

  hasAttribute(name: string): boolean {
    return this.attributes.some((a) => a.name === name);
  }
}

const el = (tag?: string): ElementLike =>
  new FakeElement(tag) as unknown as ElementLike;
const fake = (e: ElementLike): FakeElement => e as unknown as FakeElement;
const node = (n: FakeNode): Node => n as unknown as Node;

/** Attaches `e` under `parent` (a fake root or element). */
const attach = (parent: FakeNode, e: ElementLike): ElementLike => {
  parent.append(fake(e));
  return e;
};

const microtasks = () => new Promise<void>((r) => queueMicrotask(r));
const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

const tracker = (mode: ChildStateMode = 'transfer') =>
  createChildState({mode: () => mode, capMs: 200});

/** Connects `e` in `root` as the platform would (fresh by default). */
const connect = (
  cs: ReturnType<typeof tracker>,
  root: FakeNode,
  e: ElementLike,
  fresh = true
) => {
  attach(root, e);
  cs.connected(e, fresh);
};

/** Detaches `e` and reports its disconnect. */
const disconnect = (cs: ReturnType<typeof tracker>, e: ElementLike) => {
  fake(e).parentNode = null;
  cs.disconnected(e);
};

describe('pairing', () => {
  test('pairs by root, tag and drop order', async () => {
    const cs = tracker();
    const r1 = new FakeNode();
    const r2 = new FakeNode();
    const [a1, a2, b1, c1] = [el(), el(), el('y-item'), el()];
    for (const [root, e, n] of [
      [r1, a1, 1],
      [r1, a2, 2],
      [r1, b1, 3],
      [r2, c1, 4],
    ] as const) {
      connect(cs, root, e);
      fake(e).count = n;
    }

    cs.open();
    for (const e of [a1, a2, b1, c1]) {
      disconnect(cs, e);
    }
    const [n1, n2, m, y] = [el(), el(), el(), el('y-item')];
    connect(cs, r1, n1);
    connect(cs, r1, n2);
    connect(cs, r2, m);
    connect(cs, r1, y);
    await microtasks();

    expect(fake(n1).count).toBe(1);
    expect(fake(n2).count).toBe(2);
    expect(fake(y).count).toBe(3);
    expect(fake(m).count).toBe(4);
  });

  test('unmatched entries are dropped when the window closes', async () => {
    const cs = tracker();
    const root = new FakeNode();
    const old = el();
    connect(cs, root, old);
    fake(old).count = 5;

    cs.open();
    disconnect(cs, old);
    await macrotask();
    await macrotask();
    expect(cs.active).toBe(false);

    cs.open();
    const late = el();
    connect(cs, root, late);
    await microtasks();
    expect(fake(late).count).toBe(0);
  });

  test('a moved (not re-created) element is never paired', async () => {
    const cs = tracker();
    const root = new FakeNode();
    const old = el();
    const moved = el();
    connect(cs, root, old);
    connect(cs, root, moved);
    fake(old).count = 7;

    cs.open();
    disconnect(cs, old);
    connect(cs, root, moved, false);
    const fresh = el();
    connect(cs, root, fresh);
    await microtasks();

    expect(fake(moved).count).toBe(0);
    expect(fake(fresh).count).toBe(7);
  });

  test('grandchildren re-created in the new shadow match the old shadow', async () => {
    const cs = tracker();
    const doc = new FakeNode();
    const parent = el('x-parent');
    connect(cs, doc, parent);
    const oldShadow = new FakeNode();
    oldShadow.host = fake(parent);
    fake(parent).renderRoot = oldShadow;
    const grand = el();
    connect(cs, oldShadow, grand);
    fake(grand).count = 9;

    cs.open();
    disconnect(cs, parent);
    cs.disconnected(grand);
    const next = el('x-parent');
    connect(cs, doc, next);
    const newShadow = new FakeNode();
    newShadow.host = fake(next);
    const nextGrand = el();
    connect(cs, newShadow, nextGrand);
    await microtasks();

    expect(fake(nextGrand).count).toBe(9);
  });

  test("'reset' opens no window", async () => {
    const cs = tracker('reset');
    const root = new FakeNode();
    const old = el();
    connect(cs, root, old);
    fake(old).count = 3;

    cs.open();
    expect(cs.active).toBe(false);
    disconnect(cs, old);
    const fresh = el();
    connect(cs, root, fresh);
    await microtasks();
    expect(fake(fresh).count).toBe(0);
  });
});

describe('window', () => {
  test('stays open until watched updates settle, then a quiet macrotask', async () => {
    const cs = tracker();
    let resolve!: () => void;
    const updateComplete = new Promise<void>((r) => (resolve = r));
    cs.open();
    cs.watch([{updateComplete} as unknown as ElementLike]);
    await macrotask();
    await macrotask();
    expect(cs.active).toBe(true);
    resolve();
    await microtasks();
    await macrotask();
    await macrotask();
    expect(cs.active).toBe(false);
  });

  test('the hard cap closes a window whose updates never settle', async () => {
    const cs = createChildState({mode: () => 'transfer', capMs: 5});
    cs.open();
    cs.watch([
      {updateComplete: new Promise(() => {})} as unknown as ElementLike,
    ]);
    await new Promise((r) => setTimeout(r, 20));
    expect(cs.active).toBe(false);
  });

  test('a second open() while active merges into the same window', async () => {
    const cs = tracker();
    const root = new FakeNode();
    const old = el();
    connect(cs, root, old);
    fake(old).count = 4;

    cs.open();
    disconnect(cs, old);
    cs.open();
    const fresh = el();
    connect(cs, root, fresh);
    await microtasks();
    expect(fake(fresh).count).toBe(4);
  });
});

describe('templateDrivenKeys', () => {
  test('property, attribute and boolean parts targeting the element', () => {
    const n = el();
    const other = el();
    const parts: PartLike[] = [
      {type: 3, element: n, name: 'label'},
      {type: 1, element: n, name: 'FOO-BAR'},
      {type: 3, element: other, name: 'count'},
      {type: 5, element: n, name: 'click'},
    ];
    expect(templateDrivenKeys(n, parts)).toEqual(new Set(['label', 'fooBar']));
  });

  test('attributes present on the element (static attributes)', () => {
    const n = el();
    fake(n).attributes = [
      {name: 'count', value: '1'},
      {name: 'secret', value: '1'},
      {name: 'id', value: 'x'},
    ];
    // `secret` has `attribute: false`, `id` isn't reactive.
    expect([...templateDrivenKeys(n, undefined)]).toEqual(['count']);
  });

  test('uses __attributeToPropertyMap when the class exposes it', () => {
    class Mapped extends FakeElement {
      static __attributeToPropertyMap = new Map([['lbl', 'label']]);
    }
    const n = new Mapped() as unknown as ElementLike;
    fake(n).attributes = [{name: 'lbl', value: 'x'}];
    expect([...templateDrivenKeys(n, undefined)]).toEqual(['label']);
  });
});

describe('transferState', () => {
  test('copies reactive properties except template-driven ones', () => {
    const o = el();
    const n = el();
    Object.assign(fake(o), {count: 2, label: 'old', fooBar: 3, secret: 4});
    fake(n).label = 'new';
    fake(n).attributes = [{name: 'foo-bar', value: '8'}];
    fake(n).fooBar = 8;
    transferState(o, n, [{type: 3, element: n, name: 'label'}]);
    expect(fake(n)).toMatchObject({
      count: 2,
      label: 'new',
      fooBar: 8,
      secret: 4,
    });
  });

  test('when the walk failed, only attribute-driven keys are skipped', () => {
    const o = el();
    const n = el();
    Object.assign(fake(o), {count: 2, label: 'old'});
    fake(n).label = 'new';
    transferState(o, n, undefined);
    expect(fake(n)).toMatchObject({count: 2, label: 'old'});
  });

  test('copies only #private symbols, never string-keyed own props', () => {
    const o = el();
    const n = el();
    const mine = Symbol.for(`${PRIVATE_KEY_PREFIX}/src/x.ts:X#count`);
    const foreign = Symbol.for('something-else');
    const local = Symbol('local');
    const r = fake(o) as unknown as Record<PropertyKey, unknown>;
    r[mine] = 5;
    r[foreign] = 6;
    r[local] = 7;
    r['__internal'] = 8;
    expect(privateKeys(o)).toEqual([mine]);
    transferState(o, n, []);
    const t = fake(n) as unknown as Record<PropertyKey, unknown>;
    expect(t[mine]).toBe(5);
    expect(foreign in t).toBe(false);
    expect(local in t).toBe(false);
    expect('__internal' in t).toBe(false);
  });
});

describe('part walk and reuse safety', () => {
  /** A container holding a template instance, dev or prod names. */
  const container = (parts: PartLike[], prod: boolean): FakeNode => {
    const root = new FakeNode();
    const instance = prod
      ? {_$AD: {}, _$AV: [undefined, ...parts]}
      : {_$template: {}, _$parts: [undefined, ...parts]};
    root['_$litPart$'] = prod
      ? {type: 2, _$AH: instance}
      : {type: 2, _$committedValue: instance};
    return root;
  };

  for (const prod of [false, true]) {
    test(`walks nested instances and iterables (${prod ? 'prod' : 'dev'} names)`, () => {
      const n = el();
      const bound: PartLike = {type: 3, element: n, name: 'label'};
      const inner = prod
        ? {type: 2, _$AH: [{type: 2, _$AH: {_$AD: {}, _$AV: [bound]}}]}
        : {
            type: 2,
            _$committedValue: [
              {type: 2, _$committedValue: {_$template: {}, _$parts: [bound]}},
            ],
          };
      const root = container([inner as PartLike], prod);
      attach(root, n);
      const parts = partsAround(n as unknown as Node);
      expect(parts).toContain(bound);
      expect(isReuseSafe(n, parts)).toBe(false);
    });
  }

  test('an element no part touches is safe to swap', () => {
    const n = el();
    const root = container([{type: 1, element: el(), name: 'x'}], false);
    attach(root, n);
    expect(isReuseSafe(n, partsAround(node(fake(n))))).toBe(true);
  });

  test('a child part inside the element makes it unsafe', () => {
    const n = el();
    const marker = new FakeNode();
    fake(n).append(marker);
    const part = {type: 2, _$startNode: marker, _$endNode: null};
    expect(isReuseSafe(n, [part as PartLike])).toBe(false);
  });

  test('a bound light-DOM descendant makes it unsafe', () => {
    const n = el();
    const inner = el('y-item');
    fake(n).append(fake(inner));
    expect(isReuseSafe(n, [{type: 5, element: inner, name: 'click'}])).toBe(
      false
    );
  });

  test('an unreadable part tree is never safe', () => {
    expect(isReuseSafe(el(), undefined)).toBe(false);
    expect(partsAround(node(new FakeNode()))).toBeUndefined();
  });
});
