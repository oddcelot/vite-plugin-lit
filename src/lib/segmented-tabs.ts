/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {tokens} from './tokens.js';

export interface TabItem {
  id: string;
  label: string;
  icon?: string;
}

export type SegTabSize = 'sm' | 'md';

/**
 * Inline segmented tab control. Renders a horizontal row of text-only tabs
 * with the active one highlighted by the accent color.
 *
 * Matches the SegmentedTabs spec from the Lit Design System devtools kit.
 */
@customElement('segmented-tabs')
export class SegmentedTabs extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        gap: var(--lit-devtools-space-1);
        align-self: stretch;
      }
      button {
        appearance: none;
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        border: 0;
        background: none;
        font: inherit;
        color: var(--lit-devtools-text-muted);
        padding: 0 var(--lit-devtools-space-5);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
        transition:
          color var(--lit-devtools-dur-fast) var(--lit-devtools-ease-standard),
          border-color var(--lit-devtools-dur-fast)
            var(--lit-devtools-ease-standard),
          background var(--lit-devtools-dur-fast)
            var(--lit-devtools-ease-standard);
      }
      button:hover {
        color: var(--lit-devtools-text);
        background: var(--lit-devtools-surface-hover);
      }
      button.active {
        color: var(--lit-devtools-accent);
        border-bottom-color: var(--lit-devtools-accent);
      }
      button:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
        outline-offset: -2px;
      }
      button svg {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }
      :host([size='sm']) button {
        font-size: var(--lit-devtools-text-xs);
        padding: 0 var(--lit-devtools-space-4);
      }
      :host([size='md']) button,
      :host(:not([size])) button {
        font-size: var(--lit-devtools-text-sm);
        padding: 0 var(--lit-devtools-space-5);
      }
    `,
  ];

  @property({type: Array}) declare items: TabItem[];

  @property() declare value: string;

  @property() declare size: SegTabSize;

  constructor() {
    super();
    this.items = [];
    this.value = '';
    this.size = 'md';
  }

  private _select(id: string): void {
    this.value = id;
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: {value: id},
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    return html`
      ${this.items.map(
        (item) => html`
          <button
            role="tab"
            aria-selected=${item.id === this.value}
            class=${item.id === this.value ? 'active' : ''}
            @click=${() => this._select(item.id)}
          >
            ${item.icon
              ? html`<svg
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d=${item.icon} />
                </svg>`
              : nothing}
            ${item.label}
          </button>
        `
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'segmented-tabs': SegmentedTabs;
  }
}
