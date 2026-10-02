/**
 * Where the panel's settings persist: `chrome.storage.local`, under the keys
 * the local host hands over (`devframe:settings:global:lit` and the like),
 * unchanged. One entry per settings store, holding the whole object.
 *
 * `storage.local` rather than `sync`: the settings are a developer's view
 * preferences for one machine's DevTools, and `sync` caps an item at 8 KB.
 * Every tab's panel shares them, as every browser pointed at a dev server
 * shares that server's settings file; the enabled origins (`registry.ts`)
 * sit next to them under their own key.
 *
 * Takes the storage area as an argument, structurally typed, so it is
 * unit-testable with a fake.
 */

import type {KeyValueStorage} from '../../src/lib/devframe/local-host.js';
import type {StorageAreaLike} from './registry.js';

export const createChromeStorage = (
  area: StorageAreaLike
): KeyValueStorage => ({
  // An absent key is absent from the result, so this reads `undefined`.
  get: async (key) => (await area.get(key))[key],
  set: async (key, value) => void (await area.set({[key]: value})),
});
