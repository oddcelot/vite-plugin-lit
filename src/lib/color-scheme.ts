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
 * preference pins the matching `.color-scheme-light` / `.color-scheme-dark`
 * class on the document root, overriding the media query.
 */
export type ColorSchemePreference = 'auto' | 'dark' | 'light';

/** localStorage key for the panel UI color-scheme preference. */
export const COLOR_SCHEME_LS_KEY = 'lit-devtools-color-scheme';

/** Read the saved preference, defaulting to `auto`. */
export const readColorSchemePreference = (): ColorSchemePreference => {
  try {
    const raw = localStorage.getItem(COLOR_SCHEME_LS_KEY);
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
export const applyColorScheme = (pref: ColorSchemePreference): void => {
  const root = document.documentElement;
  root.classList.remove('color-scheme-light', 'color-scheme-dark');
  if (pref !== 'auto') root.classList.add('color-scheme-' + pref);
};

/** Persist a preference and apply it immediately. */
export const setColorSchemePreference = (pref: ColorSchemePreference): void => {
  try {
    localStorage.setItem(COLOR_SCHEME_LS_KEY, pref);
  } catch {
    // ignore
  }
  applyColorScheme(pref);
};
