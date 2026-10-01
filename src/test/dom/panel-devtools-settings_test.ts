import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {DevtoolsSettings} from '../../panel/devtools-settings.js';
import {meta, resetClient} from './fakes/client.js';

vi.mock('../../panel/client.js', () => import('./fakes/client.js'));

beforeAll(async () => {
  await import('../../panel/devtools-settings.js');
});

afterEach(() => {
  document.body.replaceChildren();
  resetClient();
});

const about = async () => {
  const el = document.createElement('devtools-settings') as DevtoolsSettings;
  document.body.append(el);
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
  const section = [...el.shadowRoot!.querySelectorAll('section')].find(
    (s) => s.querySelector('h3')?.textContent?.trim() === 'About'
  );
  return section?.textContent?.replace(/\s+/g, ' ');
};

test('About lists the plugin version, lit version and precedence', async () => {
  const text = await about();
  expect(text).toContain('9.9.9');
  expect(text).toContain('3.3.3');
  expect(text).toContain('unavailable (enable sourceOverlay)');
  expect(text).toContain(
    'panel override, then plugin option, then LIT_PLUGIN_* env, then default'
  );
});

test('About flags duplicate lit copies', async () => {
  meta.runtime = {ready: true, litVersions: ['3.3.3', '3.2.0'], topFrame: true};
  expect(await about()).toContain('3.3.3, 3.2.0 (duplicate copies)');
});

test('About says lit was not detected before a runtime connects', async () => {
  meta.runtime = {ready: false, litVersions: [], topFrame: true};
  expect(await about()).toContain('not detected');
});
