/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import sharedSheet from './hmr-shared-sheet.js';

/**
 * First component sharing the `hmr-shared.css` stylesheet via a shared
 * `CSSStyleSheet` object. Lit adopts the exact same sheet instance into
 * both shadow roots — when the CSS changes, `replaceSync()` on that sheet
 * updates all consumers without any component re-render.
 *
 * Compare with `hmr-linked-css` where a `<link>` href changes forces a
 * full re-render on each HMR cycle.
 *
 * Approach benefits/problems: see `hmr-shared-sheet` (inline shared sheet).
 */

@customElement('hmr-shared-css-a')
export class HmrSharedCssA extends LitElement {
  static override styles = [sharedSheet];

  private renders = 0;

  override render() {
    return html`
      <h2>Shared Sheet — A</h2>
      <div class="shared-card">Component A</div>
      <span class="shared-badge" id="badge">renders: 0</span>
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
