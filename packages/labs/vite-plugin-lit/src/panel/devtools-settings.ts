/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import type {FeatureSettings} from '../types/timeline.js';

/**
 * Settings view: a read-only mirror of the plugin's resolved feature settings,
 * fetched from `/__lit-devtools-settings`. These are config-time options, so
 * the panel surfaces them (and how to change them) rather than mutating them.
 */
@customElement('devtools-settings')
export class DevtoolsSettings extends LitElement {
  static override styles = css`
    :host {
      display: block;
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      font-size: 12px;
      line-height: 1.5;
    }
    .note {
      color: #888;
      margin: 0 0 14px;
    }
    .note code {
      color: #4fc08d;
      font-family: ui-monospace, monospace;
    }
    section {
      border: 1px solid #2d2d35;
      border-radius: 6px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 8px 12px;
      font-size: 12px;
      background: #16161b;
      border-bottom: 1px solid #2d2d35;
    }
    .pill {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 1px 7px;
      border-radius: 999px;
      border: 1px solid #3d3d45;
      color: #888;
    }
    .pill.on {
      color: #4ade80;
      border-color: #166534;
      background: #14321f;
    }
    .pill.off {
      color: #777;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      padding: 5px 12px;
      vertical-align: top;
    }
    tr:not(:last-child) td {
      border-bottom: 1px solid #1e1e26;
    }
    .key {
      color: #888;
      white-space: nowrap;
      width: 1%;
    }
    .val {
      color: #d4d4d8;
      font-family: ui-monospace, monospace;
    }
    .env {
      color: #555;
      font-family: ui-monospace, monospace;
      font-size: 10px;
    }
    .empty {
      color: #777;
      padding: 8px 12px;
    }
    .loading {
      color: #777;
    }
  `;

  @state() private _settings: FeatureSettings | null = null;
  @state() private _loaded = false;

  override connectedCallback() {
    super.connectedCallback();
    void this._fetch();
  }

  private async _fetch() {
    try {
      const res = await fetch('/__lit-devtools-settings');
      this._settings = (await res.json()) as FeatureSettings | null;
    } catch {
      this._settings = null;
    } finally {
      this._loaded = true;
    }
  }

  private _pill(on: boolean) {
    return html`<span class="pill ${on ? 'on' : 'off'}"
      >${on ? 'enabled' : 'disabled'}</span
    >`;
  }

  private _row(key: string, value: unknown, env?: string) {
    return html`
      <tr>
        <td class="key">${key}</td>
        <td class="val">
          ${String(value)}
          ${env ? html`<span class="env">${env}</span>` : nothing}
        </td>
      </tr>
    `;
  }

  override render() {
    if (!this._loaded) {
      return html`<p class="loading">Loading settings…</p>`;
    }
    const s = this._settings;
    if (s === null) {
      return html`<p class="empty">Settings unavailable.</p>`;
    }
    return html`
      <p class="note">
        Resolved from plugin options and <code>LIT_PLUGIN_*</code> env vars at
        startup. These are read-only here — change them in your Vite config or
        <code>.env</code>, then restart the dev server.
      </p>

      <section>
        <h3>HMR ${this._pill(s.hmr.enabled)}</h3>
        ${s.hmr.enabled
          ? html`<table>
              ${this._row(
                'reconnect',
                s.hmr.reconnect,
                'LIT_PLUGIN_HMR_RECONNECT'
              )}
              ${this._row(
                'on incompatible',
                s.hmr.onIncompatible,
                'LIT_PLUGIN_HMR_ON_INCOMPATIBLE'
              )}
              ${this._row(
                'indicator',
                s.hmr.indicatorEnabled,
                'LIT_PLUGIN_HMR_INDICATOR'
              )}
              ${this._row(
                'indicator count',
                s.hmr.indicatorCount,
                'LIT_PLUGIN_HMR_INDICATOR_COUNT'
              )}
            </table>`
          : html`<p class="empty">
              Enable with <code>hmr: true</code> or
              <code>LIT_PLUGIN_HMR=true</code>.
            </p>`}
      </section>

      <section>
        <h3>Source Overlay ${this._pill(s.sourceOverlay.enabled)}</h3>
        ${s.sourceOverlay.enabled
          ? html`<table>
              ${this._row(
                'hotkey',
                `Ctrl+Shift+${s.sourceOverlay.key.toUpperCase()}`,
                'LIT_PLUGIN_SOURCE_OVERLAY_KEY'
              )}
              ${this._row(
                'editor',
                s.sourceOverlay.editor,
                'LIT_PLUGIN_SOURCE_OVERLAY_EDITOR'
              )}
              ${this._row(
                'throttle (ms)',
                s.sourceOverlay.throttleMs,
                'LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS'
              )}
            </table>`
          : html`<p class="empty">
              Enable with <code>sourceOverlay: true</code> or
              <code>LIT_PLUGIN_SOURCE_OVERLAY=true</code>.
            </p>`}
      </section>

      <section>
        <h3>Timeline ${this._pill(s.timeline)}</h3>
        <p class="empty">
          Layers and recording are controlled in the Timeline tab.
        </p>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'devtools-settings': DevtoolsSettings;
  }
}
