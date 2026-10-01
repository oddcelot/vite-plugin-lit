import {expect, test, vi} from 'vite-plus/test';
import {subscribeOverrideKeys} from '../../lib/runtime/overrides.js';
import {SETTINGS_OVERRIDE_LS_KEY} from '../../types/timeline.js';

test('subscribeOverrideKeys runs only the handlers whose key is set', () => {
  localStorage.setItem(
    SETTINGS_OVERRIDE_LS_KEY,
    JSON.stringify({hmrIndicatorCount: true, flashUpdates: false})
  );
  const count = vi.fn();
  const visible = vi.fn();
  const flash = vi.fn();
  subscribeOverrideKeys(undefined, {
    hmrIndicatorCount: count,
    hmrIndicatorVisible: visible,
    flashUpdates: flash,
  });
  expect(count).toHaveBeenCalledWith(true);
  // `false` is a value, not "unset".
  expect(flash).toHaveBeenCalledWith(false);
  // Unset: the config-time default stands.
  expect(visible).not.toHaveBeenCalled();
});
