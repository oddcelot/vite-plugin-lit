/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';

/**
 * The key fixture: `render()` composes two separate `html` literals plus an
 * `<input>` in the outer template. Editing the header literal must rebuild
 * only the header part — the list keeps DOM identity and the input keeps
 * focus, value, and selection.
 */
@customElement('hmr-siblings')
export class HmrSiblings extends LitElement {
  static override styles = css`
    input:focus {
      outline: 2px solid dodgerblue;
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  private renders = 0;

  private renderHeader() {
    return html`<header id="header"><h2>Siblings: HELLO</h2></header>`;
  }

  private renderList() {
    return html`
      <ul id="list">
        <li>alpha</li>
        <li>beta</li>
        <li>gamma</li>
      </ul>
    `;
  }

  override render() {
    return html`
      ${this.renderHeader()} ${this.renderList()}
      <input id="text" placeholder="type here" />
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
