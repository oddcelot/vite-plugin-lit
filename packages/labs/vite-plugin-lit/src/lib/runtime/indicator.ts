/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Custom element for the HMR update indicator.
 * Injected by the Vite plugin as an external module so that
 * `import.meta.hot` is available.
 */

import {FONT_MONO_VAR} from './fonts.js';

// Phosphor Icons (https://phosphoricons.com, MIT) `flame`, inlined as markup so
// the indicator stays a single self-contained runtime module with no asset
// imports. Sized and recolored via CSS (`#icon svg { width/height; fill }`).
const FLAME_ICON = `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M183.89,153.34a57.6,57.6,0,0,1-46.56,46.55A8.75,8.75,0,0,1,136,200a8,8,0,0,1-1.32-15.89c16.57-2.79,30.63-16.85,33.44-33.45a8,8,0,0,1,15.78,2.68ZM216,144a88,88,0,0,1-176,0c0-27.92,11-56.47,32.66-84.85a8,8,0,0,1,11.93-.89l24.12,23.41,22-60.41a8,8,0,0,1,12.63-3.41C165.21,36,216,84.55,216,144Zm-16,0c0-46.09-35.79-85.92-58.21-106.33L119.52,98.74a8,8,0,0,1-13.09,3L80.06,76.16C64.09,99.21,56,122,56,144a72,72,0,0,0,144,0Z"></path></svg>`;

class LitDevtoolsIndicator extends HTMLElement {
  #initialized = false;
  #count = 0;
  #container: HTMLElement;
  #countEl: HTMLElement | null = null;

  constructor() {
    super();
    const withCount = this.hasAttribute('count');
    const idleOpacity = withCount ? '.5' : '0';

    const root = this.attachShadow({mode: 'closed'});
    root.innerHTML = `
      <style>
        @keyframes pulse{0%{opacity:${idleOpacity}}15%{opacity:1}80%{opacity:1}100%{opacity:${idleOpacity}}}
        :host{
          position:fixed;inset:0;display:grid;
          z-index:2147483647;pointer-events:none;
          padding:var(--lit-devtools-hmr-indicator-padding,16px)
        }
        #container{
          place-self:var(--lit-devtools-hmr-indicator-align,end end);
          display:flex;align-items:stretch;
          background:rgba(26,26,46,.85);color:#fff;
          border-radius:var(--lit-devtools-radius,6px);
          font:12px/1 ${FONT_MONO_VAR};font-variant-numeric:tabular-nums;
          overflow:hidden;opacity:${idleOpacity}
        }
        #container.active{animation:pulse 2.5s ease-out forwards}
        #icon{display:flex;align-items:center;justify-content:center;padding:0 10px}
        #icon svg{width:16px;height:16px;display:block;fill:currentColor}
        #indicator{
          display:flex;align-items:center;gap:6px;
          padding:7px 12px;
          border-left:1px solid rgba(255,255,255,.14)
        }
        .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0}
      </style>
      <div id="container"><span id="icon">${FLAME_ICON}</span><span id="indicator"><span class="dot"></span>${withCount ? '<span class="count">0</span>' : ''}</span></div>
    `;
    this.#container = root.getElementById('container')!;
    this.#countEl = root.querySelector('.count');
  }

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    (
      import.meta as {hot?: {on: (event: string, cb: () => void) => void}}
    ).hot?.on('vite:afterUpdate', () => {
      if (this.#countEl !== null) {
        this.#countEl.textContent = String(++this.#count);
      }
      this.#container.classList.remove('active');
      void this.#container.offsetWidth;
      this.#container.classList.add('active');
    });
  }
}

customElements.define('lit-devtools-indicator', LitDevtoolsIndicator);
