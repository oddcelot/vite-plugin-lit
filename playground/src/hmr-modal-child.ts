/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

/**
 * Child counter rendered inside the modal dialog. Its @state count must
 * survive HMR updates, and the parent's dialog must stay open when this
 * component is edited.
 */
@customElement('hmr-modal-child')
export class HmrModalChild extends LitElement {
  static override styles = css`
    p {
      margin: 0 0 0.75rem;
      color: var(--muted, #666);
    }
    button:focus {
      outline: 2px solid dodgerblue;
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
      margin-left: 0.5rem;
    }
  `;

  @state()
  private count = 0;

  private renders = 0;

  override render() {
    return html`
      <p>This counter is inside a native &lt;dialog&gt; element.</p>
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
