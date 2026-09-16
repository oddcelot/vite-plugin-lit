/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import '@lit-labs/virtualizer';

/**
 * Virtualized-list surface. `<lit-virtualizer scroller>` keeps its layout
 * and scroll state on the element instance, and it sits in its own template
 * literal — so a header edit never rebuilds it and the scroll offset
 * survives the patch. The ITEMS array and the renderItem closure are
 * re-created on re-execution (new identities, equal content): the
 * virtualizer reflows over equal content, which must not move the scroller.
 */
const ITEMS: ReadonlyArray<{index: number; label: string}> = Array.from(
  {length: 1000},
  (_, index) => ({index, label: `Row ${index}`})
);

@customElement('hmr-virtualizer')
export class HmrVirtualizer extends LitElement {
  static override styles = css`
    lit-virtualizer {
      height: 180px;
      border: 1px solid var(--card-border, #ccc);
      border-radius: 4px;
    }
    .row {
      display: block;
      width: 100%;
      padding: 4px 8px;
      box-sizing: border-box;
    }
    .row:nth-child(even) {
      background: rgba(127, 127, 127, 0.08);
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  private renders = 0;

  private renderHeader() {
    return html`<h2>Virtualizer: HELLO</h2>`;
  }

  private renderList() {
    return html`
      <lit-virtualizer
        id="list"
        scroller
        .items=${ITEMS}
        .renderItem=${(item: {index: number; label: string}) =>
          html`<span class="row" data-index=${item.index}>${item.label}</span>`}
      ></lit-virtualizer>
    `;
  }

  override render() {
    return html`
      ${this.renderHeader()} ${this.renderList()}
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
