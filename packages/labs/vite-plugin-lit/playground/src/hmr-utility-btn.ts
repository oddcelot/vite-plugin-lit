/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import utilitySheet from './hmr-utility-sheet.js';

/**
 * Button styled via utility classes from a shared stylesheet — simulates a
 * Tailwind/UnoCSS workflow. All utility consumers update in place when the
 * generated CSS changes (e.g. a new theme color), without re-rendering.
 *
 * Approach benefits/problems: see `hmr-utility-sheet` (fetched shared sheet).
 */

@customElement('hmr-utility-btn')
export class HmrUtilityBtn extends LitElement {
  static override styles = [utilitySheet];

  @property()
  variant: 'blue' | 'red' = 'blue';

  private renders = 0;

  override render() {
    const bgClass = this.variant === 'blue' ? 'bg-blue' : 'bg-red';
    return html`
      <button
        class="${bgClass} text-white font-bold py-2 px-4 rounded border-none cursor-pointer"
      >
        <slot></slot>
      </button>
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
