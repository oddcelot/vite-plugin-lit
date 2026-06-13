/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import cssHref from './hmr-import-css.css?hmr-url';

/**
 * Styles loaded via @import inside a <style> element in the shadow root.
 *
 * The plugin's `?hmr-url` import query yields a real stylesheet URL — the
 * dev server serves the CSS file directly, and `vite build` emits it as a
 * hashed `.css` asset — so the @import fetches actual CSS, not Vite's
 * JS-wrapped module.
 *
 * When the .css file changes, Vite's HMR propagates through the query's
 * wrapper module to this component module. Re-execution imports a freshly
 * cache-busted URL and the component re-renders, making the browser refetch
 * the stylesheet.
 */

@customElement('hmr-import-css')
export class HmrImportCss extends LitElement {
  private renders = 0;

  override render() {
    return html`
      <style>
        @import url('${cssHref}');
      </style>
      <h2>@import CSS</h2>
      <div id="imported-box">styled via @import</div>
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
