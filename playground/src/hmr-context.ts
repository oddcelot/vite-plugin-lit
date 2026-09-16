/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {consume, provide} from '@lit/context';
import {counterContext} from './context-def.js';

/**
 * Context API surface: a provider whose `@provide` value is also `@state`
 * (bumping it pushes to subscribed consumers), and a consumer nested in
 * its shadow DOM. The consumer sits in its own template literal so
 * provider-header edits never rebuild the consumer element; the
 * ContextProvider/ContextConsumer controllers live on the (untouched)
 * instances and must keep working after either class is hot-patched.
 */
@customElement('hmr-ctx-provider')
export class HmrCtxProvider extends LitElement {
  static override styles = css`
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  @provide({context: counterContext})
  @state()
  private counter = 0;

  private renders = 0;

  private renderHeader() {
    return html`<h2>Context: HELLO</h2>`;
  }

  override render() {
    return html`
      ${this.renderHeader()}
      <button id="provide-increment" @click=${this.increment}>
        Provided: ${this.counter}
      </button>
      <hmr-ctx-consumer></hmr-ctx-consumer>
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
    this.counter++;
  }
}

@customElement('hmr-ctx-consumer')
export class HmrCtxConsumer extends LitElement {
  static override styles = css`
    #consumed {
      font-weight: 600;
    }
  `;

  @consume({context: counterContext, subscribe: true})
  @state()
  private counter?: number;

  private renders = 0;

  override render() {
    return html`<p id="consumed">Consumed: ${this.counter}</p>`;
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
  }
}
