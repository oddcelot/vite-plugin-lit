/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

/**
 * Child that shows whether it was re-created: `instance` is a plain field,
 * so it changes whenever the element is new, while `count` (`@state`) and
 * `#taps` (`#private`) are what `hmr.childState` carries across.
 */
@customElement('hmr-rebuild-child')
export class HmrRebuildChild extends LitElement {
  static override styles = css`
    :host {
      display: block;
      margin-top: 0.25rem;
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
      font-family: var(--font-mono, monospace);
    }
  `;

  @property()
  label = 'unbound';

  @state()
  private count = 0;

  #taps = 0;

  private readonly instance = Math.random().toString(36).slice(2, 6);

  override render() {
    return html`
      <button @click=${this.increment}>${this.label}: ${this.count}</button>
      <span class="badge">#taps ${this.#taps} · instance ${this.instance}</span>
    `;
  }

  private increment() {
    this.#taps++;
    this.count++;
  }
}

/**
 * Parent that renders both children in the same template literal as its
 * title, so editing the title re-creates them. The bound child always gets
 * transferred state; the unbound one is put back whole under `'reuse'`.
 */
@customElement('hmr-rebuild-parent')
export class HmrRebuildParent extends LitElement {
  override render() {
    return html`
      <h2>Rebuilt parent: ONE</h2>
      <hmr-rebuild-child .label=${'bound'}></hmr-rebuild-child>
      <hmr-rebuild-child></hmr-rebuild-child>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hmr-rebuild-parent': HmrRebuildParent;
    'hmr-rebuild-child': HmrRebuildChild;
  }
}
