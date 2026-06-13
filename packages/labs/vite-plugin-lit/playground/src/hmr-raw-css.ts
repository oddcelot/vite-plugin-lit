/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, unsafeCSS} from 'lit';
import {customElement} from 'lit/decorators.js';
import rawCss from './hmr-raw-css.css?raw';

/**
 * CSS file as static styles: the inline path.
 *
 * When the CSS *should* ship inside the JS bundle (one request, adopted
 * stylesheet instead of a <link> fetch), `?raw` imports the file text and
 * `unsafeCSS` wraps it for `static styles` — lit turns it into a constructed
 * CSSStyleSheet adopted by every instance's shadow root.
 *
 * When the .css file changes, Vite's HMR invalidates the `?raw` module,
 * which propagates to this component module. The module re-executes with
 * the new text and the Lit HMR plugin hot-swaps the class's static styles
 * on live instances.
 *
 * Caveat: `?raw` returns the file text verbatim, bypassing Vite's CSS
 * pipeline — no Lightning CSS/PostCSS processing applies (unlike the
 * `?hmr-url` demos), so stick to natively supported syntax here.
 */

@customElement('hmr-raw-css')
export class HmrRawCss extends LitElement {
  static override styles = unsafeCSS(rawCss);

  private renders = 0;

  override render() {
    return html`
      <h2>Raw CSS</h2>
      <div id="raw-box">styled via ?raw static styles</div>
      <span class="badge" id="badge">renders: 0</span>
    `;
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
    const badge = this.renderRoot.querySelector('#badge');
    if (badge !== null) {
      badge.textContent = `renders: ${this.renders}`;
    }
  }
}
