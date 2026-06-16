/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Panel color-scheme preference, persisted in `localStorage`.
 *
 * `auto` is the default and needs no JavaScript: the token values injected by
 * {@link injectTokens} in `tokens.ts` react to `prefers-color-scheme` via
 * `@media`, so the panel follows whatever scheme its host requests — the OS
 * when standalone, or the embedding app's `color-scheme` when docked in the
 * Vite DevTools shell (the iframe inherits it). An explicit `light`/`dark`
 * preference pins the matching `.theme-light` / `.theme-dark` class on the
 * document root, overriding the media query.
 */
export type ThemePreference = 'auto' | 'dark' | 'light';

/** localStorage key for the panel UI color-scheme preference. */
export const THEME_LS_KEY = 'lit-devtools-theme';

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

/**
 * Apply a preference to the document root. `light`/`dark` pin the matching
 * class; `auto` removes both and lets the `prefers-color-scheme` `@media` rule
 * in the injected tokens own the scheme (and live-update on OS changes).
 */
export const applyTheme = (pref: ThemePreference): void => {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  if (pref !== 'auto') root.classList.add('theme-' + pref);
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
