/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import './timeline-view.js';

interface Tab {
  id: string;
  label: string;
}

/**
 * Tabs hosted by the panel. The Timeline is the first; this list is the
 * extension point for future Lit DevTools views (components, etc.).
 */
const TABS: readonly Tab[] = [
  {id: 'timeline', label: 'Timeline'},
  {id: 'about', label: 'About'},
];

/**
 * Root of the Lit DevTools panel — a tabbed shell. Each tab's view is kept
 * mounted and merely hidden when inactive, so the Timeline keeps recording
 * (and holds its events) while another tab is in front.
 */
@customElement('timeline-app')
export class TimelineApp extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
      font-size: 13px;
      background: #1a1a1f;
      color: #d4d4d8;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 12px;
      border-bottom: 1px solid #2d2d35;
      background: #16161b;
      flex-shrink: 0;
    }
    .logo {
      color: #4fc08d;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 10px 0;
    }
    .tabs {
      display: flex;
      gap: 2px;
      align-self: stretch;
    }
    .tab {
      appearance: none;
      border: 0;
      background: none;
      color: #888;
      font: inherit;
      font-size: 12px;
      padding: 0 12px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .tab:hover {
      color: #d4d4d8;
    }
    .tab.active {
      color: #d4d4d8;
      border-bottom-color: #4fc08d;
    }
    .view {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }
    .about {
      padding: 16px 20px;
      line-height: 1.6;
      color: #a0a0b0;
      overflow-y: auto;
    }
    .about h2 {
      margin: 0 0 4px;
      font-size: 14px;
      color: #d4d4d8;
    }
    .about ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }
    .about code {
      color: #4fc08d;
      font-family: ui-monospace, monospace;
    }
  `;

  @state() private _tab = 'timeline';

  private _select(id: string) {
    this._tab = id;
  }

  private _renderAbout() {
    return html`
      <div class="about">
        <h2>Lit DevTools</h2>
        <p>
          Development tooling for Lit, served by
          <code>@lit-labs/vite-plugin-lit</code>.
        </p>
        <ul>
          <li>
            <strong>Timeline</strong> — record lifecycle, render and input
            events per element.
          </li>
          <li>Hot module replacement for Lit components.</li>
          <li>Source overlay — jump from a rendered element to its source.</li>
        </ul>
      </div>
    `;
  }

  override render() {
    return html`
      <header>
        <span class="logo">Lit DevTools</span>
        <nav class="tabs" role="tablist">
          ${TABS.map(
            (t) => html`
              <button
                role="tab"
                aria-selected=${t.id === this._tab}
                class="tab ${t.id === this._tab ? 'active' : ''}"
                @click=${() => this._select(t.id)}
              >
                ${t.label}
              </button>
            `
          )}
        </nav>
      </header>
      <div class="view">
        <timeline-view ?hidden=${this._tab !== 'timeline'}></timeline-view>
        ${this._tab === 'about' ? this._renderAbout() : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-app': TimelineApp;
  }
}
