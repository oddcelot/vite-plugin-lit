import {describe, expect, test, vi} from 'vite-plus/test';
import {
  ENABLED_ORIGINS_KEY,
  createRegistry,
  handleRegistryRequest,
  normalizeOrigin,
} from '../../../extension/src/registry.js';
import type {ContentScript} from '../../../extension/src/registry.js';

// `chrome.scripting`, `chrome.storage.local` and `chrome.permissions` as far
// as the registry uses them, with Chrome's rejections where they matter.
const fakeChrome = (granted: string[] = []) => {
  const scripts = new Map<string, ContentScript>();
  const store: Record<string, unknown> = {};
  const scripting = {
    scripts,
    async registerContentScripts(list: ContentScript[]) {
      if (list.some((s) => scripts.has(s.id))) {
        throw new Error('Duplicate script ID');
      }
      for (const s of list) scripts.set(s.id, s);
    },
    async unregisterContentScripts(filter?: {ids?: string[]}) {
      const ids = filter?.ids ?? [...scripts.keys()];
      if (ids.some((id) => !scripts.has(id))) {
        throw new Error('Nonexistent script ID');
      }
      for (const id of ids) scripts.delete(id);
    },
    async getRegisteredContentScripts(filter?: {ids?: string[]}) {
      return [...scripts.values()].filter(
        (s) => filter?.ids === undefined || filter.ids.includes(s.id)
      );
    },
  };
  const storage = {
    store,
    async get(key: string) {
      return key in store ? {[key]: store[key]} : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
  };
  const permissions = {
    granted,
    async contains({origins}: {origins: string[]}) {
      return origins.every((o) => granted.includes(o));
    },
    removeFails: false,
    async remove({origins}: {origins: string[]}) {
      if (this.removeFails) throw new Error('cannot remove');
      for (const o of origins) {
        const i = granted.indexOf(o);
        if (i >= 0) granted.splice(i, 1);
      }
      return true;
    },
  };
  return {
    scripting,
    storage,
    permissions,
    registry: createRegistry({scripting, storage, permissions}),
  };
};

describe('normalizeOrigin', () => {
  test('keeps http(s) origins, with their port, and nothing else', () => {
    expect(normalizeOrigin('https://example.com/a/b?c')).toBe(
      'https://example.com'
    );
    expect(normalizeOrigin('http://127.0.0.1:8080')).toBe(
      'http://127.0.0.1:8080'
    );
    expect(normalizeOrigin('chrome://extensions')).toBeUndefined();
    expect(normalizeOrigin('file:///tmp/a.html')).toBeUndefined();
    expect(normalizeOrigin('not a url')).toBeUndefined();
  });
});

describe('extension registry', () => {
  test('enabling registers the MAIN-world runtime and the relay', async () => {
    const {registry, scripting, storage} = fakeChrome([
      'https://example.com/*',
    ]);
    const status = await registry.enable('https://example.com/some/page');
    expect(status).toEqual({
      origin: 'https://example.com',
      enabled: true,
      permitted: true,
    });
    const common = {
      matches: ['https://example.com/*'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    };
    expect([...scripting.scripts.values()]).toEqual([
      {
        ...common,
        id: 'lit-page@https://example.com',
        js: ['page.js'],
        world: 'MAIN',
      },
      {
        ...common,
        id: 'lit-content@https://example.com',
        js: ['content.js'],
        world: 'ISOLATED',
      },
    ]);
    expect(storage.store[ENABLED_ORIGINS_KEY]).toEqual(['https://example.com']);
  });

  test('refuses an origin without its host permission', async () => {
    const {registry, scripting} = fakeChrome();
    const status = await registry.enable('https://example.com');
    expect(status).toMatchObject({enabled: false, permitted: false});
    expect(status.error).toMatch(/permission/);
    expect(scripting.scripts.size).toBe(0);
  });

  test('enabling twice re-registers instead of failing on duplicate ids', async () => {
    const {registry, scripting, storage} = fakeChrome([
      'https://example.com/*',
    ]);
    await registry.enable('https://example.com');
    // A half-registered origin heals too.
    scripting.scripts.delete('lit-content@https://example.com');
    const status = await registry.enable('https://example.com');
    expect(status.enabled).toBe(true);
    expect(scripting.scripts.size).toBe(2);
    expect(storage.store[ENABLED_ORIGINS_KEY]).toEqual(['https://example.com']);
  });

  test('disabling unregisters only that origin', async () => {
    const {registry, scripting, storage} = fakeChrome([
      'https://a.test/*',
      'https://b.test/*',
    ]);
    await registry.enable('https://a.test');
    await registry.enable('https://b.test');
    const status = await registry.disable('https://a.test');
    expect(status).toEqual({
      origin: 'https://a.test',
      enabled: false,
      permitted: false,
    });
    expect([...scripting.scripts.keys()]).toEqual([
      'lit-page@https://b.test',
      'lit-content@https://b.test',
    ]);
    expect(storage.store[ENABLED_ORIGINS_KEY]).toEqual(['https://b.test']);
    // Nothing registered: still no rejection.
    await expect(registry.disable('https://a.test')).resolves.toMatchObject({
      enabled: false,
    });
  });

  test('disabling gives the host permission back, and forget() then has nothing to do', async () => {
    const {registry, scripting, permissions} = fakeChrome([
      'https://a.test/*',
      'https://b.test/*',
    ]);
    await registry.enable('https://a.test');
    await registry.disable('https://a.test');
    expect(permissions.granted).toEqual(['https://b.test/*']);
    // What `permissions.onRemoved` reports back: no second unregister.
    const unregister = vi.spyOn(scripting, 'unregisterContentScripts');
    await registry.forget(['https://a.test/*']);
    expect(unregister).not.toHaveBeenCalled();
  });

  test('a permission that cannot be removed does not fail disabling', async () => {
    const {registry, permissions} = fakeChrome(['https://a.test/*']);
    await registry.enable('https://a.test');
    permissions.removeFails = true;
    await expect(registry.disable('https://a.test')).resolves.toEqual({
      origin: 'https://a.test',
      enabled: false,
      permitted: true,
    });
  });

  test('status needs both the stored flag and the scripts', async () => {
    const {registry, scripting} = fakeChrome(['https://a.test/*']);
    expect(await registry.status('https://a.test')).toEqual({
      origin: 'https://a.test',
      enabled: false,
      permitted: true,
    });
    await registry.enable('https://a.test');
    expect((await registry.status('https://a.test/x')).enabled).toBe(true);
    scripting.scripts.clear();
    expect((await registry.status('https://a.test')).enabled).toBe(false);
  });

  test('forgets origins whose permission was removed', async () => {
    const {registry, scripting, storage} = fakeChrome([
      'https://a.test/*',
      'https://b.test/*',
    ]);
    await registry.enable('https://a.test');
    await registry.enable('https://b.test');
    await registry.forget(['https://a.test/*']);
    expect(storage.store[ENABLED_ORIGINS_KEY]).toEqual(['https://b.test']);
    expect(scripting.scripts.size).toBe(2);
    await registry.forget(['<all_urls>']);
    expect(storage.store[ENABLED_ORIGINS_KEY]).toEqual([]);
    expect(scripting.scripts.size).toBe(0);
  });

  test('answers the runtime messages, and rejects non-web origins', async () => {
    const {registry} = fakeChrome(['https://a.test/*']);
    await expect(
      handleRegistryRequest(registry, {
        type: 'lit:enable',
        origin: 'https://a.test',
      })
    ).resolves.toMatchObject({enabled: true});
    await expect(
      handleRegistryRequest(registry, {
        type: 'lit:status',
        origin: 'https://a.test',
      })
    ).resolves.toMatchObject({enabled: true});
    await expect(
      handleRegistryRequest(registry, {
        type: 'lit:disable',
        origin: 'https://a.test',
      })
    ).resolves.toMatchObject({enabled: false});
    await expect(
      handleRegistryRequest(registry, {
        type: 'lit:enable',
        origin: 'chrome://extensions',
      })
    ).resolves.toMatchObject({enabled: false, error: 'not an http(s) origin'});
  });
});
