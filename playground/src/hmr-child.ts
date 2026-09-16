/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

/**
 * Nested child with its own `@state`; must survive parent-template edits
 * without re-rendering.
 */
@customElement('hmr-child')
export class HmrChild extends LitElement {
  static override styles = css`
    button:focus {
      outline: 2px solid dodgerblue;
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  @state()
  private count = 0;

  private renders = 0;

  override render() {
    return html`
      <button id="child-increment" @click=${this.increment}>
        Child count: ${this.count}
      </button>
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

  private increment() {
    this.count++;
  }
}
