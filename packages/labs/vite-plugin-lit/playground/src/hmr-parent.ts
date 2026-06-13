/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import './hmr-child.js';

/**
 * Parent whose title lives in its own template literal: editing it must
 * leave the `<hmr-child>` element (and its `@state`) untouched.
 */
@customElement('hmr-parent')
export class HmrParent extends LitElement {
  static override styles = css`
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  private renders = 0;

  private renderTitle() {
    return html`<h2 id="title">Parent: ONE</h2>`;
  }

  override render() {
    return html`
      ${this.renderTitle()}
      <hmr-child id="child"></hmr-child>
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
