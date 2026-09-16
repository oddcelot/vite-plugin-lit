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
 *    tokens on `:host`. Semantic color aliases (`--lit-devtools-bg`, `--lit-devtools-surface`, `--lit-devtools-text`,
 *    etc.) are inherited from `:root`, where {@link injectTokens} installs them.
 *    Use as `static styles = [tokens, css`…`]`.
 *  - **`injectTokens()`** — injects `:root { … }` into the page `<head>` once.
 *    This makes semantic aliases available to every devtools surface, both
 *    runtime elements (indicator, source-overlay) that build their shadow DOM
 *    via `innerHTML` and Lit panel components that inherit from `:root`.
 *    The injected stylesheet reacts to `prefers-color-scheme` and to
 *    `.color-scheme-light` / `.color-scheme-dark` classes on `:root`.
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
  --lit-devtools-lit-blue:        #324fff;
  --lit-devtools-lit-blue-bright: #4d63ff;
  --lit-devtools-lit-indigo:      #2a2c9d;
  --lit-devtools-lit-dark-blue:   #283198;
  --lit-devtools-lit-cyan:        #00ffff;
  --lit-devtools-lit-dark-cyan:   #00e8ff;

  /* ---- Neutral ink scale (0 = near-black, 13 = white) ---- */
  --lit-devtools-ink-0:  hsl(0 0% 1%);
  --lit-devtools-ink-1:  hsl(0 0% 5%);
  --lit-devtools-ink-2:  hsl(0 0% 7%);
  --lit-devtools-ink-3:  hsl(0 0% 11%);
  --lit-devtools-ink-4:  hsl(0 0% 13%);
  --lit-devtools-ink-5:  hsl(0 0% 16%);
  --lit-devtools-ink-6:  hsl(0 0% 21%);
  --lit-devtools-ink-7:  hsl(0 0% 28%);
  --lit-devtools-ink-8:  hsl(0 0% 38%);
  --lit-devtools-ink-9:  hsl(0 0% 57%);
  --lit-devtools-ink-10: hsl(0 0% 63%);
  --lit-devtools-ink-11: hsl(0 0% 78%);
  --lit-devtools-ink-12: hsl(0 0% 89%);
  --lit-devtools-ink-13: hsl(0 0% 100%);

  /* ---- Typography ---- */
  --lit-devtools-font-sans:  system-ui, -apple-system, 'Segoe UI', sans-serif;
  --lit-devtools-font-mono:  ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  --lit-devtools-weight-regular:   400;
  --lit-devtools-weight-medium:    500;
  --lit-devtools-weight-semibold:  600;
  --lit-devtools-weight-bold:      700;
  --lit-devtools-weight-extrabold: 800;

  --lit-devtools-text-2xs: 11px;
  --lit-devtools-text-xs:  12px;
  --lit-devtools-text-sm:  13px;
  --lit-devtools-text-md:  14px;
  --lit-devtools-text-base:16px;

  --lit-devtools-leading-tight:   1.15;
  --lit-devtools-leading-snug:    1.3;
  --lit-devtools-leading-normal:  1.5;

  --lit-devtools-tracking-tight:  -0.02em;
  --lit-devtools-tracking-snug:   -0.01em;
  --lit-devtools-tracking-normal: 0;
  --lit-devtools-tracking-wide:   0.02em;
  --lit-devtools-tracking-caps:   0.06em;

  /* ---- Spacing (4px base) ---- */
  --lit-devtools-space-0:  0;
  --lit-devtools-space-1:  2px;
  --lit-devtools-space-2:  4px;
  --lit-devtools-space-3:  6px;
  --lit-devtools-space-4:  8px;
  --lit-devtools-space-5:  12px;
  --lit-devtools-space-6:  16px;
  --lit-devtools-space-7:  20px;
  --lit-devtools-space-8:  24px;
  --lit-devtools-space-9:  32px;

  /* ---- Radius ---- */
  --lit-devtools-radius-xs:   3px;
  --lit-devtools-radius-sm:   5px;
  --lit-devtools-radius-md:   8px;
  --lit-devtools-radius-lg:   12px;
  --lit-devtools-radius-xl:   16px;
  --lit-devtools-radius-pill: 999px;

  /* ---- Elevation ---- */
  --lit-devtools-shadow-xs: 0 1px 2px hsl(0 0% 0% / 0.30);
  --lit-devtools-shadow-sm: 0 1px 5px hsl(0 0% 0% / 0.35);
  --lit-devtools-shadow-md: 0 4px 14px hsl(0 0% 0% / 0.40);
  --lit-devtools-shadow-lg: 0 12px 32px hsl(0 0% 0% / 0.50);
  --lit-devtools-shadow-xl: 0 24px 64px hsl(0 0% 0% / 0.55);
  --lit-devtools-shadow-window: 0 24px 80px hsl(0 0% 0% / 0.6),
    0 0 0 1px hsl(0 0% 100% / 0.06);
  --lit-devtools-ring: 0 0 0 2px var(--lit-devtools-accent-ring);

  /* ---- Motion ---- */
  --lit-devtools-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --lit-devtools-dur-fast:    140ms;
  --lit-devtools-dur-normal:  220ms;
`;

const darkThemeCSS = `
  /* ---- DARK · DevTools theme ---- */
  --lit-devtools-accent:               var(--lit-devtools-lit-blue-bright);
  --lit-devtools-accent-hover:         #6478ff;
  --lit-devtools-accent-pressed:       #3d54f0;
  --lit-devtools-accent-soft:          hsla(232 100% 65% / 0.16);
  --lit-devtools-accent-ring:          hsla(232 100% 65% / 0.45);
  --lit-devtools-on-accent:            #ffffff;
  --lit-devtools-accent-cyan:          var(--lit-devtools-lit-dark-cyan);

  --lit-devtools-bg:                   var(--lit-devtools-ink-0);
  --lit-devtools-surface:             var(--lit-devtools-ink-2);
  --lit-devtools-surface-low:          var(--lit-devtools-ink-1);
  --lit-devtools-surface-container:    var(--lit-devtools-ink-4);
  --lit-devtools-surface-container-high: var(--lit-devtools-ink-5);
  --lit-devtools-surface-elevated:     var(--lit-devtools-ink-6);
  --lit-devtools-surface-hover:        hsl(0 0% 100% / 0.04);
  --lit-devtools-surface-active:       hsl(0 0% 100% / 0.07);

  --lit-devtools-text:                 var(--lit-devtools-ink-12);
  --lit-devtools-text-strong:          var(--lit-devtools-ink-13);
  --lit-devtools-text-secondary:       var(--lit-devtools-ink-10);
  --lit-devtools-text-muted:           var(--lit-devtools-ink-8);
  --lit-devtools-text-link:            var(--lit-devtools-lit-blue-bright);

  --lit-devtools-border:               var(--lit-devtools-ink-6);
  --lit-devtools-border-strong:        var(--lit-devtools-ink-7);
  --lit-devtools-border-subtle:        hsl(0 0% 100% / 0.06);

  --lit-devtools-success:              hsl(158 74% 53%);
  --lit-devtools-success-soft:         hsl(158 74% 53% / 0.15);
  --lit-devtools-warning:              #f4bf4f;
  --lit-devtools-warning-soft:         hsl(43 88% 63% / 0.15);
  --lit-devtools-error:                #ff6b6b;
  --lit-devtools-error-soft:           hsl(0 100% 71% / 0.15);
  --lit-devtools-info:                 var(--lit-devtools-lit-dark-cyan);
  --lit-devtools-info-soft:            hsl(187 100% 47% / 0.15);

  --lit-devtools-selection-bg:         var(--lit-devtools-accent);
  --lit-devtools-on-selection:         #ffffff;
`;

const darkSchemeCSS = `color-scheme: dark;`;

const lightThemeCSS = `
  /* ---- LIGHT · lit.dev website theme ---- */
  --lit-devtools-accent:               var(--lit-devtools-lit-blue);
  --lit-devtools-accent-hover:         #1f3bff;
  --lit-devtools-accent-pressed:       #2a2c9d;
  --lit-devtools-accent-soft:          hsla(232 100% 60% / 0.12);
  --lit-devtools-accent-ring:          hsla(232 100% 60% / 0.40);
  --lit-devtools-on-accent:            #ffffff;
  --lit-devtools-accent-cyan:          var(--lit-devtools-lit-dark-cyan);

  --lit-devtools-bg:                   #f4f4f4;
  --lit-devtools-surface:              #ffffff;
  --lit-devtools-surface-low:          #f3f3f3;
  --lit-devtools-surface-container:    #ffffff;
  --lit-devtools-surface-container-high: #e8e8e8;
  --lit-devtools-surface-elevated:     #ffffff;
  --lit-devtools-surface-hover:        hsl(0 0% 0% / 0.04);
  --lit-devtools-surface-active:       hsl(0 0% 0% / 0.07);

  --lit-devtools-text:                 #242424;
  --lit-devtools-text-strong:          #000000;
  --lit-devtools-text-secondary:       #6e6e6e;
  --lit-devtools-text-muted:           #949494;
  --lit-devtools-text-link:            #005dc7;

  --lit-devtools-border:               #e2e2e2;
  --lit-devtools-border-strong:        #c6c6c6;
  --lit-devtools-border-subtle:        hsl(0 0% 0% / 0.07);

  --lit-devtools-success:              #00865b;
  --lit-devtools-success-soft:         hsl(158 100% 26% / 0.10);
  --lit-devtools-warning:              #b26a00;
  --lit-devtools-warning-soft:         hsl(40 100% 35% / 0.10);
  --lit-devtools-error:                #ba1a1a;
  --lit-devtools-error-soft:           hsl(0 75% 42% / 0.10);
  --lit-devtools-info:                 #005dc7;
  --lit-devtools-info-soft:            hsl(210 100% 39% / 0.10);

  --lit-devtools-selection-bg:         var(--lit-devtools-accent);
  --lit-devtools-on-selection:         #ffffff;
`;

const lightSchemeCSS = `color-scheme: light;`;

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
 * (`--lit-devtools-bg`, `--lit-devtools-text`, etc.) are inherited from `:root`, where they are installed
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
 * Options for {@link injectTokens} / {@link tokenStyleText}.
 */
export interface InjectTokensOptions {
  /**
   * Also declare `color-scheme` on `:root`. Only safe when the devtools OWN
   * the target document (the panel iframe / standalone panel page). Never set
   * this when injecting into the host page: `color-scheme` on the embedder's
   * `:root` makes the UA repaint the canvas dark for apps that don't declare
   * an opaque background. Defaults to `false`.
   */
  colorScheme?: boolean;
}

/**
 * Builds the token stylesheet text injected by {@link injectTokens}.
 *
 * By default the sheet defines custom properties only — inert for the host
 * page. With `colorScheme: true` it additionally declares `color-scheme` so
 * the owning document's UA surfaces (canvas, form controls, scrollbars)
 * follow the devtools theme.
 */
export const tokenStyleText = ({
  colorScheme = false,
}: InjectTokensOptions = {}): string => {
  const dark = colorScheme
    ? `${darkThemeCSS}\n  ${darkSchemeCSS}`
    : darkThemeCSS;
  const light = colorScheme
    ? `${lightThemeCSS}\n  ${lightSchemeCSS}`
    : lightThemeCSS;
  return `
    :root {
      ${baseTokenCSS}
      ${dark}
    }
    @media (prefers-color-scheme: light) {
      :root {
        ${light}
      }
    }
    :root.color-scheme-light {
      ${light}
    }
    :root.color-scheme-dark {
      ${dark}
    }
  `;
};

/**
 * Injects `:root { … }` into the page `<head>` once.
 *
 * CSS custom properties defined on `:root` cascade through shadow DOM
 * boundaries, so this makes every `var(--lit-devtools-accent)` etc. resolve inside both
 * runtime elements (indicator, source-overlay) and Lit panel components.
 *
 * The injected stylesheet reacts to `prefers-color-scheme` and to
 * `.color-scheme-light` / `.color-scheme-dark` classes on the document root.
 * It never sets `color-scheme` on the host page; the panel opts in via
 * {@link InjectTokensOptions.colorScheme} for its own document.
 */
export const injectTokens = (options?: InjectTokensOptions): void => {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.setAttribute('data-lit-devtools-tokens', '');
  style.textContent = tokenStyleText(options);
  document.head.prepend(style);
};
