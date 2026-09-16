/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

/**
 * Wider reactive-property surface: a reflected `@property`, a numeric
 * `@property`, and array/object `@state` values — all must survive a hot
 * patch, and the accessors must stay functional afterwards (assignments
 * still reflect and re-render).
 */
@customElement('hmr-properties')
export class HmrProperties extends LitElement {
  static override styles = css`
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  @property({type: String, reflect: true})
  label = 'initial';

  @property({type: Number})
  factor = 2;

  @state()
  private items: string[] = [];

  @state()
  private config = {colorScheme: 'auto'};

  private renders = 0;

  override render() {
    return html`
      <h2>Properties: HELLO</h2>
      <p id="label">label: ${this.label}</p>
      <p id="factor">factor: ${this.factor}</p>
      <p id="items">items: ${this.items.join(',') || '(none)'}</p>
      <p id="color-scheme">color-scheme: ${this.config.colorScheme}</p>
      <button id="add-item" @click=${this.addItem}>add item</button>
      <button id="toggle-color-scheme" @click=${this.toggleColorScheme}>
        toggle color scheme
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
    // Apply the color-scheme state to the page. `auto` removes the attribute
    // so the OS preference drives via the document `color-scheme` (declared by
    // the <meta> in index.html) + `light-dark()`; `light`/`dark` pin
    // [data-color-scheme] as a manual override. Because the @state survives a
    // hot patch and this runs after the patch's re-render, the choice survives
    // too.
    if (this.config.colorScheme === 'auto') {
      delete document.documentElement.dataset['colorScheme'];
    } else {
      document.documentElement.dataset['colorScheme'] = this.config.colorScheme;
    }
  }

  private addItem() {
    this.items = [...this.items, `item${this.items.length + 1}`];
  }

  private toggleColorScheme() {
    // Flip the *resolved* scheme: from `auto` that's the current OS preference,
    // so a dark system toggles to light (and vice versa). An explicit
    // light/dark just inverts.
    const resolved =
      this.config.colorScheme === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : this.config.colorScheme;
    this.config = {colorScheme: resolved === 'dark' ? 'light' : 'dark'};
  }
}

/**
 * The non-decorator path: `static properties` plus a plain
 * `customElements.define()` call.
 */
export class HmrStaticProps extends LitElement {
  static properties = {
    value: {state: true},
  };

  declare value: number;

  private renders = 0;

  constructor() {
    super();
    this.value = 0;
  }

  override render() {
    return html`
      <button id="static-increment" @click=${() => this.value++}>
        Static count: ${this.value}
      </button>
      <span id="badge">renders: 0</span>
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
customElements.define('hmr-static-props', HmrStaticProps);
