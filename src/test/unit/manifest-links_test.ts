import {expect, test} from 'vite-plus/test';
import {devServerUrl} from '../../lib/plugins/manifest-links.js';

test('a manifest inside the root is served from the base', () => {
  expect(
    devServerUrl(
      '/repo/app/node_modules/@x/ui/dist/custom-elements.json',
      '/repo/app',
      '/'
    )
  ).toBe('/node_modules/@x/ui/dist/custom-elements.json');
  expect(
    devServerUrl('/repo/app/custom-elements.json', '/repo/app/', '/ui')
  ).toBe('/ui/custom-elements.json');
});

test('one outside the root goes through /@fs/', () => {
  expect(
    devServerUrl(
      '/repo/node_modules/@x/ui/custom-elements.json',
      '/repo/app',
      '/'
    )
  ).toBe('/@fs/repo/node_modules/@x/ui/custom-elements.json');
  // Not fooled by a sibling directory sharing the root's prefix.
  expect(devServerUrl('/repo/app-two/c.json', '/repo/app', '/')).toBe(
    '/@fs/repo/app-two/c.json'
  );
});

test('Windows paths come out with forward slashes', () => {
  expect(devServerUrl('C:\\repo\\app\\c.json', 'C:\\repo\\app', '/')).toBe(
    '/c.json'
  );
  expect(devServerUrl('C:\\repo\\lib\\c.json', 'C:\\repo\\app', '/')).toBe(
    '/@fs/C:/repo/lib/c.json'
  );
});
