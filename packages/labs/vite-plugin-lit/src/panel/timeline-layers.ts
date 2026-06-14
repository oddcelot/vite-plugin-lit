/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';

export interface LayerState {
  id: string;
  label: string;
  color: number;
  enabled: boolean;
}

/** Strip of colored pill toggles — one per timeline layer. */
@customElement('timeline-layers')
export class TimelineLayers extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      gap: 4px;
      padding: 6px 12px;
      border-bottom: 1px solid #2d2d35;
      background: #18181e;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    button {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 10px;
      background: #2d2d35;
      border: 1px solid transparent;
      color: #a0a0b0;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
      transition: opacity 0.1s;
    }
    button.on {
      color: #d4d4d8;
    }
    button:hover {
      background: #3d3d45;
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
  `;

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
