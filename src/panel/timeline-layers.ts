/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {tokens} from '../lib/tokens.js';

export interface LayerState {
  id: string;
  label: string;
  color: number;
  enabled: boolean;
}

/** Strip of colored pill toggles — one per timeline layer. */
@customElement('timeline-layers')
export class TimelineLayers extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        gap: var(--lit-devtools-space-2);
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      button {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-4);
        border-radius: var(--lit-devtools-radius-pill);
        background: var(--lit-devtools-surface-elevated);
        border: 1px solid transparent;
        color: var(--lit-devtools-text-secondary);
        font-size: var(--lit-devtools-text-2xs);
        cursor: pointer;
        user-select: none;
        transition: opacity var(--lit-devtools-dur-fast)
          var(--lit-devtools-ease-standard);
      }
      button.on {
        color: var(--lit-devtools-text);
      }
      button:hover {
        background: var(--lit-devtools-surface-hover);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        opacity: 0.4;
      }
      button.on .dot {
        opacity: 1;
      }
    `,
  ];

  @property({type: Array}) layers: LayerState[] = [];

  private _toggle(id: string) {
    this.dispatchEvent(
      new CustomEvent<{id: string}>('layer-toggle', {
        detail: {id},
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    return html`${this.layers.map(
      (l) => html`
        <button
          class=${l.enabled ? 'on' : ''}
          title=${l.enabled ? `Hide ${l.label}` : `Show ${l.label}`}
          @click=${() => this._toggle(l.id)}
        >
          <span
            class="dot"
            style=${'background:#' + l.color.toString(16).padStart(6, '0')}
          ></span>
          ${l.label}
        </button>
      `
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-layers': TimelineLayers;
  }
}
