import {expect, test, vi} from 'vite-plus/test';
import {PANEL_WINDOW_NAME, pickInto} from '../../lib/runtime/panel-window.js';

test('opens the panel on the picked component, always under one name', () => {
  const open = vi.fn<(url: string, name: string) => null>(() => null);
  const pick = pickInto('http://localhost:5180/', open);
  pick(7);
  pick(8);
  expect(open.mock.calls).toEqual([
    ['http://localhost:5180/#tab=components&component=7', PANEL_WINDOW_NAME],
    ['http://localhost:5180/#tab=components&component=8', PANEL_WINDOW_NAME],
  ]);
});

test('replaces any hash the server address carried', () => {
  const open = vi.fn<(url: string, name: string) => null>(() => null);
  pickInto('https://dev.example/devtools/#old', open)(1);
  expect(open.mock.calls[0]![0]).toBe(
    'https://dev.example/devtools/#tab=components&component=1'
  );
});
