/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';

/**
 * Two components in one module: `hmr-probe` caches a `querySelector` result
 * and an IntersectionObserver in `firstUpdated`. Editing the sibling's
 * template re-executes the whole module — the cached refs must stay live
 * (the original roster-observer bug class).
 */
@customElement('hmr-probe-sibling')
export class HmrProbeSibling extends LitElement {
  private renders = 0;

  override render() {
    return html`<p id="sib">SIBLING</p>`;
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
  }
}

@customElement('hmr-probe')
export class HmrProbe extends LitElement {
  static override styles = css`
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  private cached?: HTMLElement;
  private observer?: IntersectionObserver;
  private observerFired = 0;
  private renders = 0;

  override render() {
    return html`
      <h2>Probe</h2>
      <div id="target">observed target</div>
      <hmr-probe-sibling></hmr-probe-sibling>
      <span class="badge" id="badge">renders: 0</span>
    `;
  }

  override firstUpdated() {
    this.cached = this.renderRoot.querySelector('#target') ?? undefined;
    this.observer = new IntersectionObserver(() => {
      this.observerFired++;
    });
    if (this.cached !== undefined) {
      this.observer.observe(this.cached);
    }
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
    const badge = this.renderRoot.querySelector('#badge');
    if (badge !== null) {
      badge.textContent = `renders: ${this.renders}`;
    }
  }

  /** The cached node is still the one in the live shadow DOM. */
  isCachedAlive(): boolean {
    return (
      this.cached !== undefined &&
      this.cached.isConnected &&
      this.cached === this.renderRoot.querySelector('#target')
    );
  }

  /** Toggles the observed target's visibility to provoke an observation. */
  pokeObserver(): void {
    if (this.cached !== undefined) {
      this.cached.hidden = !this.cached.hidden;
    }
  }

  getObserverFired(): number {
    return this.observerFired;
  }
}
