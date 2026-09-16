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
import {FLAME_ICON} from '../icons.js';
import {subscribeOverride} from './overrides.js';
import {observeEdgeInsets} from './edge-panel.js';
import {injectTokens} from '../tokens.js';

/** One entry of a Vite `vite:afterUpdate` payload. */
interface ViteUpdate {
  type?: string;
  path?: string;
  acceptedPath?: string;
}

/**
 * True when an HMR batch is purely a stylesheet swap — every update is either
 * a `css-update` or a `js-update` whose accepted module is a `.css` source
 * (the shared-sheet queries `?css-sheet`/`?raw`/`?url` all accept a `.css`
 * path). Such a batch restyles adopted sheets in place with no re-render.
 *
 * Heuristic: keyed on the accepted path ending in `.css`. Robust for this
 * plugin's own queries; a user hand-wiring `import.meta.hot.accept` on a raw
 * `.css` would also read as a style swap, which is the intended grouping. An
 * empty/missing payload can't be classified, so it counts as a re-render
 * rather than being silently dropped.
 */
function isStyleSwap(data: unknown): boolean {
  const updates = (data as {updates?: ViteUpdate[]} | undefined)?.updates;
  if (!Array.isArray(updates) || updates.length === 0) return false;
  return updates.every((u) => {
    if (u.type === 'css-update') return true;
    if (u.type === 'js-update') {
      return (u.acceptedPath ?? u.path ?? '').split('?')[0].endsWith('.css');
    }
    return false;
  });
}

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
          background:var(--lit-devtools-surface-elevated);color:var(--lit-devtools-text-strong);
          backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
          border-radius:var(--lit-devtools-radius-md);
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
          border-left:1px solid var(--lit-devtools-border-subtle)
        }
        .dot{width:8px;height:8px;border-radius:50%;background:var(--lit-devtools-success);flex-shrink:0}
        /* Style-only swaps (shared adopted stylesheet hot-swap, no re-render)
           pulse in the calmer info color and don't bump the count. */
        #container.style-swap .dot{background:var(--lit-devtools-info)}
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
    injectTokens();
    const hot = (
      import.meta as {
        hot?: {on: (event: string, cb: (data?: unknown) => void) => void};
      }
    ).hot;
    hot?.on('vite:afterUpdate', (data) => {
      // Count only updates that actually re-render/re-execute a component;
      // a pure shared-stylesheet swap (?css-sheet / ?raw / ?url adopted sheet)
      // restyles in place without re-rendering, so it pulses but doesn't count.
      const styleSwap = isStyleSwap(data);
      if (!styleSwap && this.#countEl !== null) {
        this.#countEl.textContent = String(++this.#count);
      }
      this.#container.classList.toggle('style-swap', styleSwap);
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
