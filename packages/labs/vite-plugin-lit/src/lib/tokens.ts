/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {css, unsafeCSS} from 'lit';

/**
 * Design token CSS custom properties for the Lit DevTools.
 *
 * Two entry points:
 *  - **`tokens`** — Lit `css` template that defines the theme-agnostic base
 *    tokens on `:host`. Semantic color aliases (`--bg`, `--surface`, `--text`,
 *    etc.) are inherited from `:root`, where {@link injectTokens} installs them.
 *    Use as `static styles = [tokens, css`…`]`.
 *  - **`injectTokens()`** — injects `:root { … }` into the page `<head>` once.
 *    This makes semantic aliases available to every devtools surface, both
 *    runtime elements (indicator, source-overlay) that build their shadow DOM
 *    via `innerHTML` and Lit panel components that inherit from `:root`.
 *    The injected stylesheet reacts to `prefers-color-scheme` and to
 *    `.theme-light` / `.theme-dark` classes on `:root`.
 *
 * Sourced from the lit-design skill (`tokens/colors.css`). Defaults to the
 * dark DevTools theme; the light lit.dev website palette is applied when the
 * OS/browser requests a light color scheme or when `:root` has the matching
 * theme class.
 *
 * Fonts are system stacks (no webfonts). For the branded Manrope + Roboto Mono
 * see the lit-design skill's `fonts/` directory.
 */

const baseTokenCSS = `
  /* ---- Brand · the Lit flame ---- */
  --lit-blue:        #324fff;
  --lit-blue-bright: #4d63ff;
  --lit-indigo:      #2a2c9d;
  --lit-dark-blue:   #283198;
  --lit-cyan:        #00ffff;
  --lit-dark-cyan:   #00e8ff;

  /* ---- Neutral ink scale (0 = near-black, 13 = white) ---- */
  --ink-0:  hsl(0 0% 1%);
  --ink-1:  hsl(0 0% 5%);
  --ink-2:  hsl(0 0% 7%);
  --ink-3:  hsl(0 0% 11%);
  --ink-4:  hsl(0 0% 13%);
  --ink-5:  hsl(0 0% 16%);
  --ink-6:  hsl(0 0% 21%);
  --ink-7:  hsl(0 0% 28%);
  --ink-8:  hsl(0 0% 38%);
  --ink-9:  hsl(0 0% 57%);
  --ink-10: hsl(0 0% 63%);
  --ink-11: hsl(0 0% 78%);
  --ink-12: hsl(0 0% 89%);
  --ink-13: hsl(0 0% 100%);

  /* ---- Typography ---- */
  --font-sans:  system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono:  ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  --weight-regular:   400;
  --weight-medium:    500;
  --weight-semibold:  600;
  --weight-bold:      700;
  --weight-extrabold: 800;

  --text-2xs: 11px;
  --text-xs:  12px;
  --text-sm:  13px;
  --text-md:  14px;
  --text-base:16px;

  --leading-tight:   1.15;
  --leading-snug:    1.3;
  --leading-normal:  1.5;

  --tracking-tight:  -0.02em;
  --tracking-snug:   -0.01em;
  --tracking-normal: 0;
  --tracking-wide:   0.02em;
  --tracking-caps:   0.06em;

  /* ---- Spacing (4px base) ---- */
  --space-0:  0;
  --space-1:  2px;
  --space-2:  4px;
  --space-3:  6px;
  --space-4:  8px;
  --space-5:  12px;
  --space-6:  16px;
  --space-7:  20px;
  --space-8:  24px;
  --space-9:  32px;

  /* ---- Radius ---- */
  --radius-xs:   3px;
  --radius-sm:   5px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-pill: 999px;

  /* ---- Elevation ---- */
  --shadow-xs: 0 1px 2px hsl(0 0% 0% / 0.30);
  --shadow-sm: 0 1px 5px hsl(0 0% 0% / 0.35);
  --shadow-md: 0 4px 14px hsl(0 0% 0% / 0.40);
  --shadow-lg: 0 12px 32px hsl(0 0% 0% / 0.50);
  --shadow-xl: 0 24px 64px hsl(0 0% 0% / 0.55);
  --shadow-window: 0 24px 80px hsl(0 0% 0% / 0.6),
    0 0 0 1px hsl(0 0% 100% / 0.06);
  --ring: 0 0 0 2px var(--accent-ring);

  /* ---- Motion ---- */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --dur-fast:    140ms;
  --dur-normal:  220ms;
`;

const darkThemeCSS = `
  /* ---- DARK · DevTools theme ---- */
  --accent:               var(--lit-blue-bright);
  --accent-hover:         #6478ff;
  --accent-pressed:       #3d54f0;
  --accent-soft:          hsla(232 100% 65% / 0.16);
  --accent-ring:          hsla(232 100% 65% / 0.45);
  --on-accent:            #ffffff;
  --accent-cyan:          var(--lit-dark-cyan);

  --bg:                   var(--ink-0);
  --surface:             var(--ink-2);
  --surface-low:          var(--ink-1);
  --surface-container:    var(--ink-4);
  --surface-container-high: var(--ink-5);
  --surface-elevated:     var(--ink-6);
  --surface-hover:        hsl(0 0% 100% / 0.04);
  --surface-active:       hsl(0 0% 100% / 0.07);

  --text:                 var(--ink-12);
  --text-strong:          var(--ink-13);
  --text-secondary:       var(--ink-10);
  --text-muted:           var(--ink-8);
  --text-link:            var(--lit-blue-bright);

  --border:               var(--ink-6);
  --border-strong:        var(--ink-7);
  --border-subtle:        hsl(0 0% 100% / 0.06);

  --success:              hsl(158 74% 53%);
  --success-soft:         hsl(158 74% 53% / 0.15);
  --warning:              #f4bf4f;
  --warning-soft:         hsl(43 88% 63% / 0.15);
  --error:                #ff6b6b;
  --error-soft:           hsl(0 100% 71% / 0.15);
  --info:                 var(--lit-dark-cyan);
  --info-soft:            hsl(187 100% 47% / 0.15);

  --selection-bg:         var(--accent);
  --on-selection:         #ffffff;

  color-scheme: dark;
`;

const lightThemeCSS = `
  /* ---- LIGHT · lit.dev website theme ---- */
  --accent:               var(--lit-blue);
  --accent-hover:         #1f3bff;
  --accent-pressed:       #2a2c9d;
  --accent-soft:          hsla(232 100% 60% / 0.12);
  --accent-ring:          hsla(232 100% 60% / 0.40);
  --on-accent:            #ffffff;
  --accent-cyan:          var(--lit-dark-cyan);

  --bg:                   #f4f4f4;
  --surface:              #ffffff;
  --surface-low:          #f3f3f3;
  --surface-container:    #ffffff;
  --surface-container-high: #e8e8e8;
  --surface-elevated:     #ffffff;
  --surface-hover:        hsl(0 0% 0% / 0.04);
  --surface-active:       hsl(0 0% 0% / 0.07);

  --text:                 #242424;
  --text-strong:          #000000;
  --text-secondary:       #6e6e6e;
  --text-muted:           #949494;
  --text-link:            #005dc7;

  --border:               #e2e2e2;
  --border-strong:        #c6c6c6;
  --border-subtle:        hsl(0 0% 0% / 0.07);

  --success:              #00865b;
  --success-soft:         hsl(158 100% 26% / 0.10);
  --warning:              #b26a00;
  --warning-soft:         hsl(40 100% 35% / 0.10);
  --error:                #ba1a1a;
  --error-soft:           hsl(0 75% 42% / 0.10);
  --info:                 #005dc7;
  --info-soft:            hsl(210 100% 39% / 0.10);

  --selection-bg:         var(--accent);
  --on-selection:         #ffffff;

  color-scheme: light;
`;

/**
 * Default dark theme tokens as a flat string, primarily for use by
 * {@link injectTokens}. Prefer importing `tokens` for Lit components so the
 * semantic aliases are inherited from `:root`.
 */
export const tokenCSS = `${baseTokenCSS}\n${darkThemeCSS}`;

/**
 * Lit `css` template for use in panel component shadow roots.
 *
 * ```ts
 * import {tokens} from '../lib/tokens.js';
 * // ...
 * static override styles = [tokens, css`…`];
 * ```
 *
 * This installs the theme-agnostic base tokens on `:host`. Semantic aliases
 * (`--bg`, `--text`, etc.) are inherited from `:root`, where they are installed
 * by {@link injectTokens}. The panel iframe calls `injectTokens()` from
 * \`lit-devtools-panel.ts\` so all components inherit the same dark/light theme.
 */
export const tokens = css`
  :host {
    ${unsafeCSS(baseTokenCSS)}
  }
`;

let _injected = false;

/**
 * Injects `:root { … }` into the page `<head>` once.
 *
 * CSS custom properties defined on `:root` cascade through shadow DOM
 * boundaries, so this makes every `var(--accent)` etc. resolve inside both
 * runtime elements (indicator, source-overlay) and Lit panel components.
 *
 * The injected stylesheet reacts to `prefers-color-scheme` and to
 * `.theme-light` / `.theme-dark` classes on the document root.
 */
export const injectTokens = (): void => {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.setAttribute('data-lit-devtools-tokens', '');
  style.textContent = `
    :root {
      ${baseTokenCSS}
      ${darkThemeCSS}
    }
    @media (prefers-color-scheme: light) {
      :root {
        ${lightThemeCSS}
      }
    }
    :root.theme-light {
      ${lightThemeCSS}
    }
    :root.theme-dark {
      ${darkThemeCSS}
    }
  `;
  document.head.prepend(style);
};
