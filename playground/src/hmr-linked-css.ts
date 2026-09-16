/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import cssHref from './hmr-linked-css.css?hmr-url';

/**
 * External stylesheet loaded via <link> in shadow root.
 *
 * The plugin's `?hmr-url` import query yields a real stylesheet URL — the
 * dev server serves the CSS file directly, and `vite build` emits it as a
 * hashed `.css` asset — unlike `?inline`, which would bake the CSS into the
 * JS bundle.
 *
 * When the .css file changes, Vite's HMR propagates through the query's
 * wrapper module to this component module (self-accepting via the Lit HMR
 * plugin). Re-execution imports a freshly cache-busted href and the
 * component re-renders, making the browser refetch the stylesheet.
 *
 * Tradeoffs — per-element delivery. ✅ Real cacheable `.css` asset; standard
 * `<link>`; no JS to wire. ❌ One `<link>` + `CSSStyleSheet` object per
 * instance, and every CSS edit re-renders the whole component. For a sheet
 * shared across many components, prefer a shared adopted sheet (`?css-sheet`)
 * — see ../../docs/css-delivery.md (benchmarked in bench/).
 */

@customElement('hmr-linked-css')
export class HmrLinkedCss extends LitElement {
  private renders = 0;

  override render() {
    return html`
      <link rel="stylesheet" href="${cssHref}" />
      <h2>Linked CSS</h2>
      <div id="linked-box">styled via &lt;link&gt;</div>
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
