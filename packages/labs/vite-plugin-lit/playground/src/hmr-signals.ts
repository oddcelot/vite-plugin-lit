/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {SignalWatcher, html, signal} from '@lit-labs/signals';
import {sharedCounter} from './shared-signal.js';

/**
 * Signals surface: the `SignalWatcher` mixin regenerates its intermediate
 * class on every module evaluation (exercising prototype re-parenting), the
 * signals `html` tag must intern like the core one, and both the shared
 * (separate-module) signal and the per-instance signal must keep value and
 * reactivity across a hot patch.
 */
@customElement('hmr-signal-counter')
export class HmrSignalCounter extends SignalWatcher(LitElement) {
  static override styles = css`
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  private local = signal(0);

  private renders = 0;

  override render() {
    return html`
      <h2>Signals: HELLO</h2>
      <button id="signal-increment" @click=${this.incrementShared}>
        Signal count: ${sharedCounter}
      </button>
      <button id="local-increment" @click=${this.incrementLocal}>
        Local count: ${this.local}
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
  }

  private incrementShared() {
    sharedCounter.set(sharedCounter.get() + 1);
  }

  private incrementLocal() {
    this.local.set(this.local.get() + 1);
  }
}

/**
 * Second watcher of the same shared signal — must keep mirroring updates
 * after either component is hot-patched.
 */
@customElement('hmr-signal-mirror')
export class HmrSignalMirror extends SignalWatcher(LitElement) {
  private renders = 0;

  override render() {
    return html`<p id="mirror">Mirror: ${sharedCounter}</p>`;
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
  }
}
