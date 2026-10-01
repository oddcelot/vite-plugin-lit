import {describe, expect, test} from 'vite-plus/test';
import {
  budgetedDeepEqual,
  captureChangedValues,
} from '../../lib/runtime/timeline/changed-values.js';

describe('captureChangedValues', () => {
  test('previews a primitive change', () => {
    expect(captureChangedValues({count: 1}, new Map([['count', 0]]))).toEqual([
      {key: 'count', prev: '0', next: '1', sameRef: false, equal: false},
    ]);
  });

  test('flags a new array holding the same contents', () => {
    const host = {items: [1, 2]};
    const [detail] = captureChangedValues(host, new Map([['items', [1, 2]]]))!;
    expect(detail).toMatchObject({sameRef: false, equal: true});
  });

  test('flags a re-requested update of the same reference', () => {
    const items = [1, 2];
    const [detail] = captureChangedValues(
      {items},
      new Map([['items', items]])
    )!;
    expect(detail).toMatchObject({sameRef: true, equal: false});
  });

  test('sees a difference below the preview depth', () => {
    const host = {v: {a: {b: {c: 2}}}};
    const [detail] = captureChangedValues(
      host,
      new Map([['v', {a: {b: {c: 1}}}]])
    )!;
    expect(detail!.prev).toBe(detail!.next);
    expect(detail!.equal).toBe(false);
  });

  test('records at most 16 keys', () => {
    const changed = new Map(Array.from({length: 40}, (_, i) => [`k${i}`, i]));
    expect(captureChangedValues({}, changed)).toHaveLength(16);
  });

  test('survives a throwing getter', () => {
    const host = {
      get boom(): number {
        throw new Error('nope');
      },
    };
    const [detail] = captureChangedValues(host, new Map([['boom', 1]]))!;
    expect(detail).toMatchObject({
      next: '[getter threw]',
      sameRef: false,
      equal: false,
    });
  });

  test('survives a hostile toString and toJSON', () => {
    const hostile = {
      toString() {
        throw new Error('no');
      },
      toJSON() {
        throw new Error('no');
      },
    };
    expect(() =>
      captureChangedValues({v: hostile}, new Map([['v', hostile]]))
    ).not.toThrow();
  });

  test('returns undefined without a non-empty Map', () => {
    expect(captureChangedValues({}, undefined)).toBeUndefined();
    expect(captureChangedValues({}, {a: 1})).toBeUndefined();
    expect(captureChangedValues({}, new Map())).toBeUndefined();
  });

  test('names a symbol key', () => {
    const key = Symbol('hidden');
    const [detail] = captureChangedValues({[key]: 1}, new Map([[key, 0]]))!;
    expect(detail!.key).toBe('Symbol(hidden)');
  });

  test('gives up on huge equal arrays rather than walking them', () => {
    const big = () => Array.from({length: 1000}, (_, i) => i);
    const [detail] = captureChangedValues({a: big()}, new Map([['a', big()]]))!;
    expect(detail!.equal).toBe(false);
  });
});

describe('budgetedDeepEqual', () => {
  test('compares plain objects, arrays and dates by content', () => {
    expect(
      budgetedDeepEqual(
        {a: [1, {b: 2}], d: new Date(5)},
        {a: [1, {b: 2}], d: new Date(5)}
      )
    ).toBe(true);
    expect(budgetedDeepEqual({a: 1}, {a: 1, b: 2})).toBe(false);
    expect(budgetedDeepEqual([1], {0: 1})).toBe(false);
  });

  test('treats other objects as equal only by identity', () => {
    expect(budgetedDeepEqual(new Map(), new Map())).toBe(false);
    class A {}
    expect(budgetedDeepEqual(new A(), new A())).toBe(false);
  });

  test('ends on a cycle', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    expect(budgetedDeepEqual(a, b)).toBe(false);
  });

  test('never runs a getter', () => {
    let ran = false;
    const make = () => ({
      get v() {
        ran = true;
        return 1;
      },
    });
    expect(budgetedDeepEqual(make(), make())).toBe(false);
    expect(ran).toBe(false);
  });
});
