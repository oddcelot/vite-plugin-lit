import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test';

type Warnings = typeof import('../../lib/runtime/timeline/lit-warnings.js');

const STATE = Symbol.for('@oddsquad/vite-plugin-lit#lit-warnings');
const g = globalThis as Record<string | symbol, unknown>;

const CHANGE =
  'Element x-a scheduled an update (generally because a property was set) ' +
  'after an update completed, causing a new update to be scheduled. ' +
  'See https://lit.dev/msg/change-in-update for more information.';

const load = async (): Promise<Warnings> => {
  vi.resetModules();
  return import('../../lib/runtime/timeline/lit-warnings.js');
};

beforeEach(() => {
  delete g[STATE];
  delete g.litIssuedWarnings;
});

afterEach(() => {
  delete g[STATE];
  delete g.litIssuedWarnings;
});

describe('parseLitWarning', () => {
  test('splits the docs link off and names the tag', async () => {
    const {parseLitWarning} = await load();
    expect(parseLitWarning(CHANGE)).toMatchObject({
      code: 'change-in-update',
      tagName: 'x-a',
      message: expect.not.stringContaining('lit.dev'),
    });
  });

  test('reads the tag out of the undefined-attribute message', async () => {
    const {parseLitWarning} = await load();
    const w = parseLitWarning(
      'The attribute value for the n property is undefined on element x-b. ' +
        'The attribute will be removed. ' +
        'See https://lit.dev/msg/undefined-attribute-value for more information.'
    );
    expect(w).toMatchObject({
      code: 'undefined-attribute-value',
      tagName: 'x-b',
    });
  });

  test('names the class, not a tag, for class-field shadowing', async () => {
    const {parseLitWarning} = await load();
    const w = parseLitWarning(
      'Field "count" on MyEl was declared as a reactive property but it does ' +
        'not have a getter. See https://lit.dev/msg/reactive-property-without-getter for more information.'
    );
    expect(w).toMatchObject({
      code: 'reactive-property-without-getter',
      className: 'MyEl',
    });
    expect(w?.tagName).toBeUndefined();
  });

  test('keeps an entry with no code', async () => {
    const {parseLitWarning} = await load();
    expect(
      parseLitWarning('The requestUpdate() method was called wrongly.')
    ).toMatchObject({
      code: '',
      message: 'The requestUpdate() method was called wrongly.',
    });
  });

  test('ignores bare codes, dev-mode and non-strings', async () => {
    const {parseLitWarning} = await load();
    expect(parseLitWarning('change-in-update')).toBeNull();
    expect(parseLitWarning(42)).toBeNull();
    expect(
      parseLitWarning(
        'Lit is in dev mode. Not recommended for production! See https://lit.dev/msg/dev-mode for more information.'
      )
    ).toBeNull();
  });
});

describe('installLitWarningCapture', () => {
  test('creates the Set when Lit has not and captures later adds', async () => {
    const m = await load();
    const seen: string[] = [];
    m.onLitWarning((w) => seen.push(w.code));
    m.installLitWarningCapture();
    const set = g.litIssuedWarnings as Set<string>;
    expect(set).toBeInstanceOf(Set);
    set.add(CHANGE);
    expect(seen).toEqual(['change-in-update']);
    expect(set.has(CHANGE)).toBe(true);
  });

  test('replays entries already in the Set', async () => {
    g.litIssuedWarnings = new Set([CHANGE, 'a-silenced-code']);
    const m = await load();
    m.installLitWarningCapture();
    expect(m.litWarnings().map((w) => w.code)).toEqual(['change-in-update']);
  });

  test('is idempotent', async () => {
    const m = await load();
    m.installLitWarningCapture();
    m.installLitWarningCapture();
    (g.litIssuedWarnings as Set<string>).add(CHANGE);
    expect(m.litWarnings()).toHaveLength(1);
  });

  test('attributes to the updating element only when its tag matches', async () => {
    const m = await load();
    m.installLitWarningCapture();
    m.setUpdatingResolver(() => ({tagName: 'x-a', elementId: 7}));
    (g.litIssuedWarnings as Set<string>).add(CHANGE);
    m.setUpdatingResolver(() => ({tagName: 'x-other', elementId: 8}));
    (g.litIssuedWarnings as Set<string>).add(CHANGE.replace('x-a', 'x-c'));
    expect(m.litWarnings().map((w) => w.elementId)).toEqual([7, undefined]);
  });

  test('warningsFor matches by tag or class', async () => {
    const m = await load();
    m.installLitWarningCapture();
    const set = g.litIssuedWarnings as Set<string>;
    set.add(CHANGE);
    set.add('Field "n" on MyEl was declared as a reactive property but x.');
    expect(m.warningsFor('x-a')).toHaveLength(1);
    expect(m.warningsFor('x-z', 'MyEl')).toHaveLength(1);
    expect(m.warningsFor('x-z', 'Other')).toHaveLength(0);
  });

  test('survives a listener that throws', async () => {
    const m = await load();
    m.installLitWarningCapture();
    m.onLitWarning(() => {
      throw new Error('boom');
    });
    expect(() =>
      (g.litIssuedWarnings as Set<string>).add(CHANGE)
    ).not.toThrow();
  });
});
