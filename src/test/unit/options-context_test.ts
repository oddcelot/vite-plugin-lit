import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {createOptionsContext} from '../../lib/plugins/context.js';
import {litPlugin, type LitPluginOptions} from '../../lib/plugin.js';

type Hook = (...args: unknown[]) => unknown;

const ENV_KEYS = [
  'LIT_PLUGIN_TIMELINE',
  'LIT_PLUGIN_HMR',
  'LIT_PLUGIN_SOURCE_OVERLAY',
];

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
  vi.restoreAllMocks();
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

describe('litPlugin feature gating', () => {
  const run = (options: LitPluginOptions) => {
    const plugins = litPlugin(options);
    const pre = plugins.find((p) => p.name === 'lit-plugin-options')!;
    (pre.config as Hook)(
      {root: '/nonexistent-lit-plugin-env'},
      {mode: 'development', command: 'serve'}
    );
    return plugins;
  };
  const tagsOf = (plugins: ReturnType<typeof litPlugin>) =>
    plugins.flatMap((p) => {
      const hook = p.transformIndexHtml as Hook | undefined;
      return hook ? ((hook.call({}, '', {}) as unknown[]) ?? []) : [];
    });
  const text = (tags: unknown[]) => JSON.stringify(tags);

  test('the env turning the timeline on activates the devframe feature', async () => {
    process.env.LIT_PLUGIN_TIMELINE = '1';
    const plugins = run({});
    const devframe = plugins.find((p) => p.name === 'devframe:lit')!;
    expect(devframe).toBeDefined();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const install = vi.fn(async () => {});
    await (devframe.devtools!.setup as Hook)({install});
    expect(install).toHaveBeenCalledOnce();
    expect(text(tagsOf(plugins))).toContain('timeline/install');
  });

  test('an explicit timeline: false keeps the devframe out entirely', () => {
    process.env.LIT_PLUGIN_TIMELINE = '1';
    const plugins = run({timeline: false});
    expect(plugins.some((p) => p.name === 'devframe:lit')).toBe(false);
    expect(text(tagsOf(plugins))).not.toContain('timeline/install');
  });

  test('with everything off nothing is injected, mounted or served', async () => {
    const plugins = run({
      timeline: false,
      sourceOverlay: false,
      hmr: {indicator: false},
    });
    expect(tagsOf(plugins)).toEqual([]);
    const overlay = plugins.find((p) => p.name === 'lit-source-overlay')!;
    const use = vi.fn();
    (overlay.configureServer as Hook)({
      middlewares: {use},
      config: {server: {}},
    });
    expect(use).not.toHaveBeenCalled();
    expect(
      (overlay.transform as Hook).call({}, 'customElement', '/p/a.ts', {})
    ).toBeNull();
  });

  test('the env turning the source overlay on activates it', () => {
    process.env.LIT_PLUGIN_SOURCE_OVERLAY = '1';
    const plugins = run({});
    const overlay = plugins.find((p) => p.name === 'lit-source-overlay')!;
    const use = vi.fn();
    (overlay.configureServer as Hook)({
      middlewares: {use},
      config: {server: {}},
    });
    expect(use).toHaveBeenCalledOnce();
    expect(text(tagsOf(plugins))).toContain('initSourceOverlay');
  });

  test('HMR off removes its virtual modules and private-field rewrite', () => {
    const plugins = run({hmr: false, timeline: false});
    const hmr = plugins.find((p) => p.name === 'lit-plugin')!;
    expect((hmr.resolveId as Hook).call({}, 'virtual:lit-plugin/x')).toBeNull();
    const priv = plugins.find((p) => p.name === 'lit-private-fields')!;
    expect(
      (priv.transform as Hook).call({}, 'class A { #a = 1 }', '/p/a.ts', {})
    ).toBeNull();
  });
});
