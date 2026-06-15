/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Panel color-scheme preference, persisted in `localStorage` and applied as a
 * `theme-light` / `theme-dark` class on the document root. The matching token
 * values are injected by {@link injectTokens} in `tokens.ts`.
 *
 * The anti-FOUC inline script in `index.html` resolves the same preference at
 * load to avoid a flash; the helpers here own the runtime behavior once the
 * panel module is live, including reacting to OS changes while in `auto`.
 */
export type ThemePreference = 'auto' | 'dark' | 'light';

/** localStorage key for the panel UI color-scheme preference. */
export const THEME_LS_KEY = 'lit-devtools-theme';

/**
 * Source for the anti-FOUC inline script injected into the panel's `<head>`
 * (see `timeline-plugin.ts`). It must run synchronously before paint, so it
 * can't import this module — but it derives {@link THEME_LS_KEY} from here and
 * mirrors {@link resolveTheme}, keeping the key single-sourced and the twin
 * resolve expressions adjacent. A classic inline script in `<head>` runs during
 * parse, ahead of the deferred panel module that later calls {@link applyTheme}.
 */
export const themeBootstrapScript = (): string => `(() => {
  try {
    const t = localStorage.getItem('${THEME_LS_KEY}');
    const dark = t === 'dark' ||
      (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(dark ? 'theme-dark' : 'theme-light');
  } catch {}
})();`;

/** Read the saved preference, defaulting to `auto`. */
export const readThemePreference = (): ThemePreference => {
  try {
    const raw = localStorage.getItem(THEME_LS_KEY);
    if (raw === 'auto' || raw === 'dark' || raw === 'light') return raw;
  } catch {
    // ignore
  }
  return 'auto';
};

/** Resolve a preference to a concrete scheme, following the OS for `auto`. */
const resolveTheme = (pref: ThemePreference): 'light' | 'dark' =>
  pref === 'auto'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : pref;

/**
 * Apply the resolved scheme as an explicit `theme-light` / `theme-dark` class
 * on the document root. Always concrete — even for `auto` — so the class stays
 * in sync with the one the anti-FOUC script sets at load and the OS listener
 * below can override it live.
 */
export const applyTheme = (pref: ThemePreference): void => {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  root.classList.add('theme-' + resolveTheme(pref));
};

/** Persist a preference and apply it immediately. */
export const setThemePreference = (pref: ThemePreference): void => {
  try {
    localStorage.setItem(THEME_LS_KEY, pref);
  } catch {
    // ignore
  }
  applyTheme(pref);
};

let _autoSyncStarted = false;

/**
 * Re-apply the theme when the OS color scheme changes, but only while the saved
 * preference is `auto`. An explicit `light`/`dark` preference pins the class and
 * is left untouched. Installed once; safe to call repeatedly.
 */
export const startThemeAutoSync = (): void => {
  if (_autoSyncStarted) return;
  _autoSyncStarted = true;
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (readThemePreference() === 'auto') applyTheme('auto');
    });
};
