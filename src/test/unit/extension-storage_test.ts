import {expect, test} from 'vite-plus/test';
import {createChromeStorage} from '../../../extension/src/storage.js';

// `chrome.storage.local` as far as the storage uses it: `get` answers with
// only the keys it holds, and values come back as copies, as Chrome's do.
const fakeArea = () => {
  const store: Record<string, unknown> = {};
  return {
    store,
    async get(key: string) {
      return key in store ? {[key]: structuredClone(store[key])} : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, structuredClone(items));
    },
  };
};

test('reads undefined for a key that was never written', async () => {
  const storage = createChromeStorage(fakeArea());
  expect(await storage.get('devframe:settings:global:lit')).toBeUndefined();
});

test('round-trips a value under the key it was given', async () => {
  const area = fakeArea();
  const storage = createChromeStorage(area);
  const settings = {colorScheme: 'dark', layers: {timeline: true}};
  await storage.set('devframe:settings:global:lit', settings);
  expect(area.store).toEqual({'devframe:settings:global:lit': settings});
  expect(await storage.get('devframe:settings:global:lit')).toEqual(settings);
});

test('leaves the other keys in the area alone', async () => {
  const area = fakeArea();
  area.store['enabledOrigins'] = ['https://example.com'];
  const storage = createChromeStorage(area);
  await storage.set('devframe:settings:global:lit', {a: 1});
  await storage.set('devframe:settings:global:lit', {a: 2});
  expect(area.store).toEqual({
    enabledOrigins: ['https://example.com'],
    'devframe:settings:global:lit': {a: 2},
  });
});
