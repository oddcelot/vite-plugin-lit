/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import sheet from './hmr-vsheet.css?css-sheet';

/**
 * A second adopter of the same `?css-sheet` import. Both modules import the
 * same virtual module, so they share one `CSSStyleSheet` instance — a CSS
 * edit updates both without re-rendering either.
 */

@customElement('hmr-vsheet-b')
export class HmrVsheetB extends LitElement {
  static override styles = [sheet];

  private renders = 0;

  override render() {
    return html`<span class="chip" id="chip">B</span>`;
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
  }
}
