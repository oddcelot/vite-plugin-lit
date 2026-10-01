import {afterEach, describe, expect, test} from 'vite-plus/test';
import {createOptionsContext} from '../../lib/plugins/context.js';
import type {LitPluginOptions} from '../../lib/plugin.js';

type Hook = (...args: unknown[]) => unknown;

const ENV_KEYS = ['LIT_PLUGIN_TIMELINE', 'LIT_PLUGIN_HMR'];

/** Runs the context's `config` hook against an env-less root. */
const configure = (options: LitPluginOptions) => {
  const ctx = createOptionsContext(options);
  (ctx.plugin.config as Hook)(
    {root: '/nonexistent-lit-plugin-env'},
    {mode: 'development', command: 'serve'}
  );
  return ctx;
};

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('options context resolution', () => {
  test('get() before config covers explicit options and defaults only', () => {
    process.env.LIT_PLUGIN_TIMELINE = '1';
    const ctx = createOptionsContext({});
    expect(ctx.get().timeline).toBe(false);
    expect(ctx.get().hmrEnabled).toBe(true);
  });

  test('the config hook loads env into get()', () => {
    process.env.LIT_PLUGIN_TIMELINE = '1';
    const ctx = configure({});
    expect(ctx.get().timeline).toBe(true);
  });

  test('explicit options win over env', () => {
    process.env.LIT_PLUGIN_TIMELINE = '1';
    process.env.LIT_PLUGIN_HMR = '0';
    const ctx = configure({timeline: false, hmr: true});
    expect(ctx.get().timeline).toBe(false);
    expect(ctx.get().hmrEnabled).toBe(true);
  });

  test('env fills in what options leave unset', () => {
    process.env.LIT_PLUGIN_HMR = '0';
    const ctx = configure({timeline: true});
    expect(ctx.get().hmrEnabled).toBe(false);
    expect(ctx.get().timeline).toBe(true);
  });

  test('root() is recorded from configResolved', () => {
    const ctx = createOptionsContext({});
    expect(ctx.root()).toBe('');
    (ctx.plugin.configResolved as Hook)({root: '/proj'});
    expect(ctx.root()).toBe('/proj');
  });
});

describe('options context shouldTransform', () => {
  const ctx = createOptionsContext({});

  test.each([
    '/proj/src/a.ts',
    '/proj/src/a.js?v=123',
    '/proj/src/a.mjs',
    '/proj/src/a.tsx',
    '/proj/index.html?html-proxy&index=0.js',
    '/proj/index.html?html-proxy&inline-css',
  ])('accepts %s', (id) => {
    expect(ctx.shouldTransform(id)).toBe(true);
  });

  test.each([
    '\0virtual:lit-plugin/timeline',
    '/proj/node_modules/lit/index.js',
    'C:\\proj\\node_modules\\lit\\index.js',
    '/@id/__x00__virtual:thing.js',
    '/proj/lit-plugin:thing.js',
    '/proj/src/a.css',
    '/proj/src/a.css?inline',
    '/proj/src/a.json',
    '/proj/index.html',
  ])('rejects %s', (id) => {
    expect(ctx.shouldTransform(id)).toBe(false);
  });

  test('rejects an SSR pass', () => {
    expect(ctx.shouldTransform('/proj/src/a.ts', {ssr: true})).toBe(false);
    expect(ctx.shouldTransform('/proj/src/a.ts', {ssr: false})).toBe(true);
  });
});

describe('options context relativeToRoot', () => {
  const at = (root: string) => {
    const ctx = createOptionsContext({});
    (ctx.plugin.configResolved as Hook)({root});
    return ctx;
  };

  test('strips the root from files inside it', () => {
    expect(at('/proj').relativeToRoot('/proj/src/a.ts')).toBe('src/a.ts');
  });

  test('works for a filesystem root', () => {
    expect(at('/').relativeToRoot('/src/a.ts')).toBe('src/a.ts');
  });

  test('leaves a sibling that shares the root prefix alone', () => {
    expect(at('/proj').relativeToRoot('/proj-other/a.ts')).toBe(
      '/proj-other/a.ts'
    );
  });

  test('leaves files outside the root alone', () => {
    expect(at('/proj/app').relativeToRoot('/proj/lib/a.ts')).toBe(
      '/proj/lib/a.ts'
    );
  });

  test('is a no-op before the root is known', () => {
    const ctx = createOptionsContext({});
    expect(ctx.relativeToRoot('/proj/a.ts')).toBe('/proj/a.ts');
  });
});
