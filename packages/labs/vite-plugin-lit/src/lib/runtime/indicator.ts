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
import {FLAME_ICON} from './icons.js';

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
          background:rgba(26,26,46,.72);color:#fff;
          backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
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

customElements.define('lit-devtools-hmr-indicator', LitDevtoolsIndicator);
