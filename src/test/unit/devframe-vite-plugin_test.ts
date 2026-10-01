import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test';

type Plugin = ReturnType<
  typeof import('../../lib/devframe/vite.js').createLitDevframePlugin
>;

// The warn flag is module-level, so each test loads a fresh module.
const load = async (enabled: () => boolean = () => true): Promise<Plugin> => {
  vi.resetModules();
  const {createLitDevframePlugin} = await import('../../lib/devframe/vite.js');
  return createLitDevframePlugin({version: '9.9.9', enabled});
};

const afterConfigure = (plugin: Plugin): void => {
  const hook = plugin.configureServer as unknown as () => () => void;
  hook()();
};

const runSetup = (plugin: Plugin): Promise<void> =>
  (
    plugin.devtools as unknown as {setup: (ctx: unknown) => Promise<void>}
  ).setup({install: async () => {}});

const missingWarnings = (messages: string[]): string[] =>
  messages.filter((m) => m.includes('never mounted'));

describe('missing DevTools warning', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let messages: string[];
  beforeEach(() => {
    messages = [];
    warn = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
      messages.push(String(m));
    });
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test('warns once with the plugin prefix when setup never ran', async () => {
    afterConfigure(await load());
    const calls = missingWarnings(messages);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('[lit-plugin]');
    expect(calls[0]).toContain('DevTools()');
  });

  test('stays quiet when setup ran first', async () => {
    const plugin = await load();
    await runSetup(plugin);
    afterConfigure(plugin);
    expect(missingWarnings(messages)).toHaveLength(0);
  });

  test('stays quiet when the panel is disabled', async () => {
    afterConfigure(await load(() => false));
    expect(missingWarnings(messages)).toHaveLength(0);
  });

  test('warns once across plugin instances', async () => {
    const first = await load();
    // Same module instance for the second plugin, so the flag is shared.
    const {createLitDevframePlugin} =
      await import('../../lib/devframe/vite.js');
    const second = createLitDevframePlugin({version: '9.9.9'});
    afterConfigure(first);
    afterConfigure(second);
    expect(missingWarnings(messages)).toHaveLength(1);
  });
});
