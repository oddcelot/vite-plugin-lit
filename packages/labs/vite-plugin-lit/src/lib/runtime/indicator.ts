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
import {subscribeOverride} from './overrides.js';
import {observeEdgeInsets} from './edge-panel.js';

class LitDevtoolsIndicator extends HTMLElement {
  #initialized = false;
  #count = 0;
  #container: HTMLElement;
  #countEl: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({mode: 'closed'});
    // `--idle-op` is the at-rest opacity: 0 (invisible until a pulse) without a
    // count, .5 (count stays legible) with one. The count display and idle
    // opacity are both driven by the `.with-count` class so the panel can
    // toggle the count on/off live (see #setCount).
    root.innerHTML = `
      <style>
        @keyframes pulse{0%{opacity:var(--idle-op,0)}15%{opacity:1}80%{opacity:1}100%{opacity:var(--idle-op,0)}}
        :host{
          position:fixed;inset:0;display:grid;
          z-index:2147483647;pointer-events:none;
          /* Base padding plus the inset the Vite DevTools edge panel occupies
             on each edge (set from JS), so the indicator never sits on it. */
          padding:
            calc(var(--lit-devtools-hmr-indicator-padding,16px) + var(--edge-top,0px))
            calc(var(--lit-devtools-hmr-indicator-padding,16px) + var(--edge-right,0px))
            calc(var(--lit-devtools-hmr-indicator-padding,16px) + var(--edge-bottom,0px))
            calc(var(--lit-devtools-hmr-indicator-padding,16px) + var(--edge-left,0px))
        }
        #container{
          place-self:var(--lit-devtools-hmr-indicator-align,end end);
          display:flex;align-items:stretch;
          background:rgba(26,26,46,.72);color:#fff;
          backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
          border-radius:var(--lit-devtools-radius,6px);
          font:12px/1 ${FONT_MONO_VAR};font-variant-numeric:tabular-nums;
          overflow:hidden;opacity:var(--idle-op,0)
        }
        #container.with-count{--idle-op:.5}
        #container.active{animation:pulse 2.5s ease-out forwards}
        #icon{display:flex;align-items:center;justify-content:center;padding:0 10px}
        #icon svg{width:16px;height:16px;display:block;fill:currentColor}
        #indicator{
          display:flex;align-items:center;gap:6px;
          padding:7px 12px;
          border-left:1px solid rgba(255,255,255,.14)
        }
        .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0}
        .count{display:none}
        #container.with-count .count{display:inline}
      </style>
      <div id="container"><span id="icon">${FLAME_ICON}</span><span id="indicator"><span class="dot"></span><span class="count">0</span></span></div>
    `;
    this.#container = root.getElementById('container')!;
    this.#countEl = root.querySelector('.count');
    this.#setCount(this.hasAttribute('count'));
  }

  /** Show/hide the cumulative update count (and the at-rest opacity). */
  #setCount(enabled: boolean) {
    this.#container.classList.toggle('with-count', enabled);
  }

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    const hot = (
      import.meta as {
        hot?: {on: (event: string, cb: (data?: unknown) => void) => void};
      }
    ).hot;
    hot?.on('vite:afterUpdate', () => {
      if (this.#countEl !== null) {
        this.#countEl.textContent = String(++this.#count);
      }
      this.#container.classList.remove('active');
      void this.#container.offsetWidth;
      this.#container.classList.add('active');
    });
    // Let the DevTools panel hide/show the indicator and its count live (and
    // across reloads).
    subscribeOverride(hot, (o) => {
      if (o.hmrIndicatorVisible !== undefined) {
        this.style.display = o.hmrIndicatorVisible ? '' : 'none';
      }
      if (o.hmrIndicatorCount !== undefined) {
        this.#setCount(o.hmrIndicatorCount);
      }
    });
    // Stay clear of the Vite DevTools edge panel.
    observeEdgeInsets((insets) => {
      this.style.setProperty('--edge-top', `${insets.top}px`);
      this.style.setProperty('--edge-right', `${insets.right}px`);
      this.style.setProperty('--edge-bottom', `${insets.bottom}px`);
      this.style.setProperty('--edge-left', `${insets.left}px`);
    });
  }
}

customElements.define('lit-devtools-hmr-indicator', LitDevtoolsIndicator);
