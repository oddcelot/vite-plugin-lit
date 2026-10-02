import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {DevtoolsSettings} from '../../panel/devtools-settings.js';
import {meta, resetClient} from './fakes/client.js';
import {overrides} from '../../panel/settings-override.js';

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

test('About lists the plugin version, Lit package versions and precedence', async () => {
  const text = await about();
  expect(text).toContain('9.9.9');
  expect(text).toContain('lit-html 3.3.3');
  expect(text).toContain('lit-element 4.2.2');
  expect(text).toContain('unavailable (enable sourceOverlay)');
  expect(text).toContain(
    'panel override, then plugin option, then LIT_PLUGIN_* env, then default'
  );
});

test('About flags duplicate lit copies', async () => {
  meta.runtime = {
    ready: true,
    litPackages: {'lit-element': ['4.2.2', '4.1.0']},
    topFrame: true,
  };
  expect(await about()).toContain(
    'lit-element 4.2.2, 4.1.0 (duplicate copies)'
  );
});

test('the color scheme wa-select writes the choice through the settings store', async () => {
  const el = document.createElement('devtools-settings') as DevtoolsSettings;
  document.body.append(el);
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
  const select = el.shadowRoot!.querySelector('wa-select') as HTMLElement & {
    value: string;
  };
  expect(
    [...select.querySelectorAll('wa-option')].map((o) =>
      o.getAttribute('value')
    )
  ).toEqual(['auto', 'dark', 'light']);
  select.value = 'light';
  select.dispatchEvent(new Event('change'));
  await el.updateComplete;
  expect(overrides.appearance()).toBe('light');
});

test('About says lit was not detected before a runtime connects', async () => {
  meta.runtime = {ready: false, litPackages: {}, topFrame: true};
  expect(await about()).toContain('not detected');
});
