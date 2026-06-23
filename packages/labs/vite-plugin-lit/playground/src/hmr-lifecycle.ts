/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html, nothing, type PropertyValues} from 'lit';
import {customElement, state} from 'lit/decorators.js';

/**
 * Exercises the full reactive update lifecycle so every phase shows up in the
 * DevTools Timeline's `lit-lifecycle` layer:
 *
 *   connectedCallback → (per update) performUpdate → willUpdate → update →
 *   firstUpdated (first only) → updated → … → disconnectedCallback
 *
 * Each hook is overridden and calls `super`, so the timeline (which wraps the
 * shared ReactiveElement/LitElement base) reports it. The on-screen log shows
 * the phase order of the last update for at-a-glance correlation; it's written
 * straight to the DOM in `updated()` so it never triggers another update.
 */
@customElement('hmr-lifecycle-child')
export class HmrLifecycleChild extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    button:focus {
      outline: 2px solid dodgerblue;
    }
    .log {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: #888;
      font-family: var(--font-mono, monospace);
    }
  `;

  @state()
  private count = 0;

  /** Phases seen during the in-flight update cycle (reset each willUpdate). */
  #phases: string[] = [];

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('data-connected', '');
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    // The element is leaving the DOM — nothing visible to update, but the
    // wrapped base disconnectedCallback still reports the point event.
  }

  override willUpdate(changed: PropertyValues) {
    this.#phases = ['willUpdate'];
    super.willUpdate(changed);
  }

  override update(changed: PropertyValues) {
    this.#phases.push('update');
    super.update(changed); // runs render()
  }

  override firstUpdated(changed: PropertyValues) {
    this.#phases.push('firstUpdated');
    super.firstUpdated(changed);
  }

  override updated(changed: PropertyValues) {
    this.#phases.push('updated');
    super.updated(changed);
    // Direct DOM write (no reactive property) so it doesn't loop.
    const log = this.renderRoot.querySelector('.log');
    if (log !== null) {
      log.textContent = this.#phases.join(' → ');
    }
  }

  override render() {
    return html`
      <button id="increment" @click=${() => this.count++}>
        Trigger update — count: ${this.count}
      </button>
      <div class="log">connected</div>
    `;
  }
}

/**
 * Wrapper that mounts/unmounts the child so its `connectedCallback` /
 * `disconnectedCallback` fire on demand — they only run when an element
 * actually enters or leaves the DOM, which a plain re-render won't do.
 */
@customElement('hmr-lifecycle')
export class HmrLifecycle extends LitElement {
  static override styles = css`
    button:focus {
      outline: 2px solid dodgerblue;
    }
    .controls {
      margin-bottom: 0.5rem;
    }
  `;

  @state()
  private mounted = true;

  override render() {
    return html`
      <h2>Lifecycle</h2>
      <div class="controls">
        <button id="toggle" @click=${() => (this.mounted = !this.mounted)}>
          ${this.mounted ? 'Unmount child' : 'Mount child'}
        </button>
      </div>
      ${this.mounted
        ? html`<hmr-lifecycle-child></hmr-lifecycle-child>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hmr-lifecycle': HmrLifecycle;
    'hmr-lifecycle-child': HmrLifecycleChild;
  }
}
