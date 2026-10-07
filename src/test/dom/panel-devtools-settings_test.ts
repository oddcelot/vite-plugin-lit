import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import type {DevtoolsSettings} from '../../panel/devtools-settings.js';
import {calls, meta, resetClient} from './fakes/client.js';
import {overrides} from '../../panel/settings-override.js';
import {resolveOptions, toFeatureSettings} from '../../lib/options.js';

vi.mock('../../panel/client.js', () => import('./fakes/client.js'));

beforeAll(async () => {
  await import('../../panel/devtools-settings.js');
});

afterEach(() => {
  document.body.replaceChildren();
  resetClient();
});

const mount = async () => {
  const el = document.createElement('devtools-settings') as DevtoolsSettings;
  document.body.append(el);
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
  return el.shadowRoot!;
};

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
    chromeTracks: true,
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
  meta.runtime = {
    ready: false,
    litPackages: {},
    topFrame: true,
    chromeTracks: true,
  };
  expect(await about()).toContain('not detected');
});

test('origin badges skip defaults, and the open select marks the baseline', async () => {
  meta.features = toFeatureSettings(
    resolveOptions(
      {sourceOverlay: true},
      {LIT_PLUGIN_HMR_ON_INCOMPATIBLE: 'warn'}
    )
  );
  const root = await mount();
  const row = (key: string) =>
    [...root.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('.key')?.textContent?.trim() === key
    )!;

  // childState is a built-in default: no badge, but the option says so.
  const child = row('child state');
  expect(child.querySelector('.src')).toBeNull();
  const marked = child.querySelector('wa-option .opt-src')!;
  expect(marked.closest('wa-option')!.getAttribute('value')).toBe('transfer');
  expect(marked.textContent).toBe('default');

  // onIncompatible came from env: the badge stays and the marker names env.
  const incompatible = row('on incompatible');
  expect(incompatible.querySelector('.src')?.textContent).toBe('(env)');
  // ...and the built-in default keeps its own marker beside it.
  const markers = Object.fromEntries(
    [...incompatible.querySelectorAll('wa-option .opt-src')].map((m) => [
      m.closest('wa-option')!.getAttribute('value'),
      m.textContent,
    ])
  );
  expect(markers).toEqual({warn: 'env', reload: 'default'});

  expect(child.querySelector('.key')!.getAttribute('data-tip')).toContain(
    'Default: transfer'
  );
});

test('the chrome tracks row links to the guide on where the tracks appear', async () => {
  meta.features = toFeatureSettings(resolveOptions({timeline: true}, {}));
  const root = await mount();
  const link = root.querySelector('wa-button.docs-link')!;
  expect(link.getAttribute('href')).toMatch(
    /\/guides\/devtools\/timeline\/#see-it-in-chromes-performance-panel$/
  );
  expect(link.getAttribute('target')).toBe('_blank');
});

test('explains missing plugin settings off the Vite plugin', async () => {
  meta.capabilities.pluginSettings = false;
  const text = (await mount()).querySelector('.empty')!.textContent!.trim();
  expect(text).toBe(
    'Plugin settings need the Vite plugin; this page is inspected without a Vite dev server.'
  );
});

test('keeps the plain message when the plugin simply sent no settings', async () => {
  const root = await mount();
  expect(root.querySelector('.empty')!.textContent!.trim()).toBe(
    'Settings unavailable.'
  );
  expect(root.querySelector('wa-switch')).toBeNull();
});

test('off the Vite plugin, the page-side preferences still switch on', async () => {
  meta.capabilities.pluginSettings = false;
  const root = await mount();
  const row = (key: string) =>
    [...root.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('.key')?.textContent?.trim() === key
    );
  expect(row('flash updates')).toBeDefined();
  const tracks = row('chrome performance tracks')!.querySelector('wa-switch')!;
  tracks.checked = true;
  tracks.dispatchEvent(new Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    calls
      .filter((c) => c.name === 'set-settings-override')
      .map((c) => c.args[0])
  ).toContainEqual(expect.objectContaining({chromeTracks: true}));
});

test('a feature header says where the feature was switched, and how to turn it on', async () => {
  meta.features = toFeatureSettings(
    resolveOptions({hmr: false}, {LIT_PLUGIN_TIMELINE: 'true'})
  );
  const root = await mount();
  const card = (title: string) =>
    [...root.querySelectorAll('wa-card')].find((c) =>
      c.querySelector('h3')?.textContent?.trim().startsWith(title)
    )!;
  const badge = (title: string) =>
    card(title).querySelector('h3 .src')?.textContent ?? null;

  expect(badge('HMR')).toBe('(option)');
  expect(badge('Timeline')).toBe('(env)');
  // Off by default: nothing to attribute.
  expect(badge('Source Overlay')).toBeNull();

  const hint = (title: string) =>
    card(title)
      .querySelector('.empty')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
  expect(hint('HMR')).toBe('Enable with hmr: true or LIT_PLUGIN_HMR=true.');
  expect(hint('Source Overlay')).toBe(
    'Enable with sourceOverlay: true or LIT_PLUGIN_SOURCE_OVERLAY=true.'
  );
});

test("the chrome tracks switch locks when the page's browser can't draw them", async () => {
  meta.capabilities.pluginSettings = false;
  meta.runtime = {...meta.runtime, ready: true, chromeTracks: false};
  const root = await mount();
  const row = [...root.querySelectorAll('tr')].find(
    (tr) =>
      tr.querySelector('.key')?.textContent?.trim() ===
      'chrome performance tracks'
  )!;
  const tracks = row.querySelector('wa-switch')!;
  expect(tracks.disabled).toBe(true);
  expect(tracks.textContent?.trim()).toBe('needs Chrome 134+');
  expect(row.classList.contains('row-disabled')).toBe(true);
});
