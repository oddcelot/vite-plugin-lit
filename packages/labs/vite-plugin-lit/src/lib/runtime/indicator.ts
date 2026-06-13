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

class LitDevtoolsIndicator extends HTMLElement {
  #initialized = false;
  #count = 0;
  #container: HTMLElement;
  #countEl: HTMLElement | null = null;

  constructor() {
    super();
    const withCount = this.hasAttribute('count');
    const idleOpacity = withCount ? '.5' : '0';

    const containerStyle = withCount
      ? `display:flex;align-items:center;gap:5px;padding:5px 10px 5px 7px;background:rgba(26,26,46,.85);color:#fff;border-radius:20px;font:12px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;opacity:${idleOpacity}`
      : `width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(26,26,46,.85);opacity:${idleOpacity}`;

    const root = this.attachShadow({mode: 'closed'});
    root.innerHTML = `
      <style>
        @keyframes pulse{0%{opacity:${idleOpacity}}15%{opacity:1}80%{opacity:1}100%{opacity:${idleOpacity}}}
        :host{
          position:fixed;inset:0;display:grid;
          z-index:2147483647;pointer-events:none;
          padding:var(--lit-devtools-hmr-indicator-padding,16px)
        }
        #container{place-self:var(--lit-devtools-hmr-indicator-align,end end);${containerStyle}}
        #container.active{animation:pulse 2.5s ease-out forwards}
        .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0}
      </style>
      <div id="container"><span class="dot"></span>${withCount ? '<span class="count">0</span>' : ''}</div>
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
