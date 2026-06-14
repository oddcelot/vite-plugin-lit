/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import utilitySheet from './hmr-utility-sheet.js';

/**
 * Badge styled via the same shared utility sheet as `hmr-utility-btn`.
 * A completely different component type, sharing the same set of utility
 * classes. CSS edits propagate to both without re-render.
 *
 * Approach benefits/problems: see `hmr-utility-sheet` (fetched shared sheet).
 */

@customElement('hmr-utility-badge')
export class HmrUtilityBadge extends LitElement {
  static override styles = [utilitySheet];

  private renders = 0;

  override render() {
    return html`
      <span class="bg-green text-white text-xs font-bold px-4 py-2 rounded"
        >Badge</span
      >
      <span class="font-mono text-xs" id="badge">renders: 0</span>
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
