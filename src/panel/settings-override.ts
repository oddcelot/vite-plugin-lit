/**
 * The panel's adapter onto the shared override module (`lib/settings-override`).
 *
 * Three copies have to agree — `localStorage` (the app runtime reads it
 * synchronously at boot, before any DevTools connection exists), devframe's
 * per-user settings store (the durable one, survives a different browser),
 * and the live page (pushed over RPC so a loaded app reacts now). This file
 * only supplies the ports for those; any tab that flips a preference goes
 * through {@link overrides} so all three move together and every other tab
 * showing the same preference re-renders.
 */

import {applyColorScheme} from '../lib/color-scheme.js';
import {createSettingsOverrides} from '../lib/settings-override.js';
import {litRpc, litSettingsRpc} from './client.js';

const quiet = (p: Promise<unknown>): void => {
  p.catch(() => {
    // dev tool — ignore connection/call errors
  });
};

export const overrides = createSettingsOverrides({
  storage: {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
  },
  live: {
    push: (o) =>
      quiet(litRpc().then((rpc) => rpc.rpc.call('set-settings-override', o))),
  },
  durable: {
    set: (key: 'override' | 'overrideBaselines' | 'appearance', value: never) =>
      quiet(
        litSettingsRpc().then((rpc) => rpc.settings.global.set(key, value))
      ),
    delete: (key) =>
      quiet(litSettingsRpc().then((rpc) => rpc.settings.global.delete(key))),
  },
  applyAppearance: applyColorScheme,
});
