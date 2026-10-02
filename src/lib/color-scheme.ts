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
 *
 * Storing and adopting the preference is the settings override module's
 * (`settings-override.ts`); this file is the DOM half, plus the synchronous
 * read the panel does before its first paint.
 */
import {
  COLOR_SCHEME_LS_KEY,
  parseColorScheme,
  type ColorSchemePreference,
} from './settings-override.js';

export type {ColorSchemePreference} from './settings-override.js';

/** Read the saved preference, defaulting to `auto`. */
export const readColorSchemePreference = (): ColorSchemePreference => {
  try {
    return parseColorScheme(localStorage.getItem(COLOR_SCHEME_LS_KEY));
  } catch {
    return 'auto';
  }
};

/**
 * Web Awesome switches schemes by class only (`.wa-dark`), never by media
 * query, so mirror the resolved scheme onto it — including `auto`, which
 * follows `prefers-color-scheme` live through the listener below.
 */
let current: ColorSchemePreference = 'auto';
let lightQuery: MediaQueryList | undefined;

const syncWebAwesomeScheme = (): void => {
  // Ask for light, as tokens.ts does: dark is the default when the host
  // states no preference.
  if (!lightQuery && typeof matchMedia === 'function') {
    lightQuery = matchMedia('(prefers-color-scheme: light)');
    lightQuery.addEventListener('change', syncWebAwesomeScheme);
  }
  const dark =
    current === 'dark' || (current === 'auto' && !lightQuery?.matches);
  document.documentElement.classList.toggle('wa-dark', dark);
};

/**
 * Apply a preference to the document root. `light`/`dark` pin the matching
 * class; `auto` removes both and lets the `prefers-color-scheme` `@media` rule
 * in the injected tokens own the scheme (and live-update on OS changes).
 * Either way the resolved scheme is mirrored onto `.wa-dark`.
 */
export const applyColorScheme = (pref: ColorSchemePreference): void => {
  const root = document.documentElement;
  root.classList.remove('color-scheme-light', 'color-scheme-dark');
  if (pref !== 'auto') root.classList.add('color-scheme-' + pref);
  current = pref;
  syncWebAwesomeScheme();
};
