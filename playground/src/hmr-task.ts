/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {Task} from '@lit/task';
import {USER_COUNT, fakeFetchUser} from './fake-api.js';

/**
 * `@lit/task` surface: an async Task (fake fetch with latency) driven by an
 * `@state` arg. The Task controller and its completed value live on the
 * instance, so a hot patch must neither lose the loaded content nor trigger
 * a re-fetch (the patch's requestUpdate re-runs `args()`, which are
 * shallow-equal — Task stays COMPLETE). Args-driven re-runs must still work
 * afterwards.
 *
 * Note: the task function itself is captured by the controller at
 * construction — editing its *body* affects only future instances, like any
 * instance-captured state. Edit templates to see HMR; reload to swap fetch
 * logic.
 */
@customElement('hmr-task')
export class HmrTask extends LitElement {
  static override styles = css`
    #pending {
      color: var(--muted, #666);
      font-style: italic;
    }
    #error {
      color: #e63946;
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  @state()
  private userId = 1;

  private userTask = new Task(this, {
    task: ([id], {signal}) => fakeFetchUser(id, signal),
    args: () => [this.userId] as const,
  });

  private renders = 0;

  private renderHeader() {
    return html`<h2>Task: HELLO</h2>`;
  }

  override render() {
    return html`
      ${this.renderHeader()}
      <button id="next-user" @click=${this.nextUser}>next user</button>
      <div id="result">
        ${this.userTask.render({
          pending: () =>
            html`<p id="pending">fetching user ${this.userId}…</p>`,
          complete: (user) =>
            html`<p id="user"><strong>${user.name}</strong> — ${user.bio}</p>`,
          error: (e) => html`<p id="error">${String(e)}</p>`,
        })}
      </div>
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

  private nextUser() {
    this.userId = (this.userId % USER_COUNT) + 1;
  }
}
