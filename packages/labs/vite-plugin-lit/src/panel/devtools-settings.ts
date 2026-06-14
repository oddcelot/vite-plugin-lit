/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {
  SETTINGS_OVERRIDE_LS_KEY,
  type FeatureSettings,
  type SettingsOverride,
} from '../types/timeline.js';

/** GET resolved settings / POST a {@link SettingsOverride} (server rebroadcasts). */
const SETTINGS_PATH = '/__lit-devtools-settings';

/**
 * Settings view. Shows the plugin's resolved feature settings and lets the
 * HMR ones be overridden live — persisted (same-origin localStorage, read by
 * the app runtime on load) and pushed over HMR for immediate effect. Settings
 * whose feature is disabled at config time can't be enabled here (their runtime
 * isn't injected); those stay read-only.
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
    .reset {
      margin-left: auto;
      appearance: none;
      border: 1px solid #3d3d45;
      background: #2d2d35;
      color: #d4d4d8;
      border-radius: 4px;
      font: inherit;
      font-size: 10px;
      padding: 2px 8px;
      cursor: pointer;
    }
    .reset:hover {
      background: #3d3d45;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      padding: 5px 12px;
      vertical-align: middle;
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
    .ovr {
      color: #fbbf24;
      font-size: 10px;
      margin-left: 6px;
    }
    label.toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    input,
    select {
      accent-color: #4fc08d;
      font: inherit;
      font-family: ui-monospace, monospace;
    }
    select {
      background: #2d2d35;
      color: #d4d4d8;
      border: 1px solid #3d3d45;
      border-radius: 4px;
      padding: 1px 4px;
    }
    .row-disabled {
      opacity: 0.5;
    }
    .empty {
      color: #777;
      padding: 8px 12px;
    }
    .empty code {
      color: #4fc08d;
      font-family: ui-monospace, monospace;
    }
    .loading {
      color: #777;
    }
  `;

  @state() private _settings: FeatureSettings | null = null;
  @state() private _override: SettingsOverride = {};
  @state() private _loaded = false;

  override connectedCallback() {
    super.connectedCallback();
    this._override = this._readOverride();
    void this._fetch();
  }

  private _readOverride(): SettingsOverride {
    try {
      const raw = localStorage.getItem(SETTINGS_OVERRIDE_LS_KEY);
      if (raw !== null) return JSON.parse(raw) as SettingsOverride;
    } catch {
      // ignore
    }
    return {};
  }

  private async _fetch() {
    try {
      const res = await fetch(SETTINGS_PATH);
      this._settings = (await res.json()) as FeatureSettings | null;
    } catch {
      this._settings = null;
    } finally {
      this._loaded = true;
    }
  }

  /** Persist the merged override and push it to the app runtime. */
  private _push(override: SettingsOverride) {
    this._override = override;
    try {
      localStorage.setItem(SETTINGS_OVERRIDE_LS_KEY, JSON.stringify(override));
    } catch {
      // ignore
    }
    fetch(SETTINGS_PATH, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(override),
    }).catch(() => {
      // dev tool — ignore network errors
    });
  }

  private _set<K extends keyof SettingsOverride>(
    key: K,
    value: SettingsOverride[K]
  ) {
    this._push({...this._override, [key]: value});
  }

  /** Clear overrides and revert the runtime to the resolved env values. */
  private _reset() {
    const s = this._settings;
    try {
      localStorage.removeItem(SETTINGS_OVERRIDE_LS_KEY);
    } catch {
      // ignore
    }
    this._override = {};
    if (s !== null) {
      // Send the env values explicitly so the live runtime reverts now (an
      // empty override would leave the current live values in place).
      fetch(SETTINGS_PATH, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          hmrReconnect: s.hmr.reconnect,
          hmrOnIncompatible: s.hmr.onIncompatible,
          hmrIndicatorVisible: s.hmr.indicatorEnabled,
          hmrIndicatorCount: s.hmr.indicatorCount,
        } satisfies SettingsOverride),
      }).catch(() => {});
    }
  }

  private _pill(on: boolean) {
    return html`<span class="pill ${on ? 'on' : ''}"
      >${on ? 'enabled' : 'disabled'}</span
    >`;
  }

  private _ovr(overridden: boolean) {
    return overridden ? html`<span class="ovr">overridden</span>` : nothing;
  }

  private _readonlyRow(key: string, value: unknown, env?: string) {
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

  private _renderHmr(s: FeatureSettings) {
    const o = this._override;
    if (!s.hmr.enabled) {
      return html`<p class="empty">
        Enable with <code>hmr: true</code> or <code>LIT_PLUGIN_HMR=true</code>.
      </p>`;
    }
    const reconnect = o.hmrReconnect ?? s.hmr.reconnect;
    const onIncompatible = o.hmrOnIncompatible ?? s.hmr.onIncompatible;
    // The indicator element only exists when enabled at config time, so it can
    // be hidden/shown (and its count toggled) live but not created here.
    const indicatorVisible = o.hmrIndicatorVisible ?? s.hmr.indicatorEnabled;
    const indicatorCount = o.hmrIndicatorCount ?? s.hmr.indicatorCount;
    return html`
      <table>
        <tr>
          <td class="key">reconnect</td>
          <td class="val">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${reconnect}
                @change=${(e: Event) =>
                  this._set(
                    'hmrReconnect',
                    (e.target as HTMLInputElement).checked
                  )}
              />
              ${reconnect ? 'on' : 'off'}
            </label>
            ${this._ovr(o.hmrReconnect !== undefined)}
          </td>
        </tr>
        <tr>
          <td class="key">on incompatible</td>
          <td class="val">
            <select
              .value=${onIncompatible}
              @change=${(e: Event) =>
                this._set(
                  'hmrOnIncompatible',
                  (e.target as HTMLSelectElement).value as 'reload' | 'warn'
                )}
            >
              <option value="reload">reload</option>
              <option value="warn">warn</option>
            </select>
            ${this._ovr(o.hmrOnIncompatible !== undefined)}
          </td>
        </tr>
        <tr class=${s.hmr.indicatorEnabled ? '' : 'row-disabled'}>
          <td class="key">indicator</td>
          <td class="val">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${indicatorVisible}
                ?disabled=${!s.hmr.indicatorEnabled}
                @change=${(e: Event) =>
                  this._set(
                    'hmrIndicatorVisible',
                    (e.target as HTMLInputElement).checked
                  )}
              />
              ${s.hmr.indicatorEnabled
                ? indicatorVisible
                  ? 'shown'
                  : 'hidden'
                : 'off (config)'}
            </label>
            ${this._ovr(o.hmrIndicatorVisible !== undefined)}
          </td>
        </tr>
        <tr class=${s.hmr.indicatorEnabled ? '' : 'row-disabled'}>
          <td class="key">indicator count</td>
          <td class="val">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${indicatorCount}
                ?disabled=${!s.hmr.indicatorEnabled}
                @change=${(e: Event) =>
                  this._set(
                    'hmrIndicatorCount',
                    (e.target as HTMLInputElement).checked
                  )}
              />
              ${indicatorCount ? 'shown' : 'hidden'}
            </label>
            ${this._ovr(o.hmrIndicatorCount !== undefined)}
          </td>
        </tr>
      </table>
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
    const hasOverride = Object.keys(this._override).length > 0;
    return html`
      <p class="note">
        Resolved from plugin options and <code>LIT_PLUGIN_*</code> env at
        startup. HMR settings can be overridden live below; the rest are
        config-time (change them in your Vite config / <code>.env</code> and
        restart).
      </p>

      <section>
        <h3>
          HMR ${this._pill(s.hmr.enabled)}
          ${hasOverride
            ? html`<button class="reset" @click=${this._reset}>
                Reset to env
              </button>`
            : nothing}
        </h3>
        ${this._renderHmr(s)}
      </section>

      <section>
        <h3>Source Overlay ${this._pill(s.sourceOverlay.enabled)}</h3>
        ${s.sourceOverlay.enabled
          ? html`<table>
              ${this._readonlyRow(
                'hotkey',
                `Ctrl+Shift+${s.sourceOverlay.key.toUpperCase()}`,
                'LIT_PLUGIN_SOURCE_OVERLAY_KEY'
              )}
              ${this._readonlyRow(
                'editor',
                s.sourceOverlay.editor,
                'LIT_PLUGIN_SOURCE_OVERLAY_EDITOR'
              )}
              ${this._readonlyRow(
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
