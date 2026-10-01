import {expect, test} from 'vite-plus/test';
import {baselineChanged} from '../../lib/override-baselines.js';

test('a changed value is reported, an equal one is not', () => {
  expect(baselineChanged('hmrReconnect', true, false)).toBe(true);
  expect(baselineChanged('hmrReconnect', true, true)).toBe(false);
  expect(baselineChanged('sourceOverlayEditor', 'zed', 'cursor')).toBe(true);
  expect(baselineChanged('hmrOnIncompatible', {a: 1}, {a: 1})).toBe(false);
});

test('a legacy override with no recorded baseline never nudges', () => {
  expect(baselineChanged('hmrReconnect', undefined, true)).toBe(false);
  expect(baselineChanged('hmrReconnect', true, undefined)).toBe(false);
});

test('a custom editor is not compared', () => {
  expect(baselineChanged('sourceOverlayEditor', 'zed', 'custom')).toBe(false);
  expect(baselineChanged('sourceOverlayEditor', 'custom', 'zed')).toBe(false);
});
