/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import sharedSheet from './hmr-shared-sheet.js';

/**
 * Second component sharing the `hmr-shared.css` stylesheet via a shared
 * `CSSStyleSheet` object. Same pattern as `hmr-shared-css-a` — both adopt
 * the same sheet, so CSS edits update both without re-rendering either.
 *
 * Approach benefits/problems: see `hmr-shared-sheet` (inline shared sheet).
 */

@customElement('hmr-shared-css-b')
export class HmrSharedCssB extends LitElement {
  static override styles = [sharedSheet];

  private renders = 0;

  override render() {
    return html`
      <h2>Shared Sheet — B</h2>
      <div class="shared-card">Component B</div>
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
