/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

/**
 * `@state` count survives an edit to this component's own template.
 */
@customElement('hmr-counter')
export class HmrCounter extends LitElement {
  static override styles = css`
    button:focus {
      outline: 2px solid dodgerblue;
    }
    .badge {
      display: inline-block;
      margin-left: 0.5rem;
      font-size: 0.8em;
      color: #666;
    }
  `;

  @state()
  private count = 0;

  private renders = 0;

  override render() {
    return html`
      <h2>Counter: HELLO</h2>
      <button id="increment" @click=${this.increment}>
        Count: ${this.count}
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
