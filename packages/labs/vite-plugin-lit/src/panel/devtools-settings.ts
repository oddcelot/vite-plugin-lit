/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {tokens} from '../lib/tokens.js';
import {
  SETTINGS_OVERRIDE_LS_KEY,
  SOURCE_OVERLAY_EDITORS,
  type FeatureSettings,
  type SettingsOverride,
} from '../types/timeline.js';

/** GET resolved settings / POST a {@link SettingsOverride} (server rebroadcasts). */
const SETTINGS_PATH = '/__lit-devtools-settings';

/** localStorage key for the panel UI color-scheme preference. */
const THEME_LS_KEY = 'lit-devtools-theme';

export type ThemePreference = 'auto' | 'dark' | 'light';

/**
 * Settings view. Shows the plugin's resolved feature settings and lets the
 * HMR ones be overridden live — persisted (same-origin localStorage, read by
 * the app runtime on load) and pushed over HMR for immediate effect. Settings
 * whose feature is disabled at config time can't be enabled here (their runtime
 * isn't injected); those stay read-only.
 */
@customElement('devtools-settings')
export class DevtoolsSettings extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: block;
        flex: 1;
        overflow-y: auto;
        padding: var(--space-5) var(--space-6);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
      }
      .note {
        color: var(--text-muted);
        margin: 0 0 var(--space-5);
      }
      .note code {
        color: var(--accent);
        font-family: var(--font-mono);
      }
      section {
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        margin-bottom: var(--space-5);
        overflow: hidden;
      }
      h3 {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin: 0;
        padding: var(--space-3) var(--space-5);
        font-size: var(--text-xs);
        background: var(--surface-low);
        border-bottom: 1px solid var(--border);
      }
      .pill {
        font-size: var(--text-2xs);
        font-weight: var(--weight-semibold);
        text-transform: uppercase;
        letter-spacing: var(--tracking-caps);
        padding: 1px var(--space-4);
        border-radius: var(--radius-pill);
        border: 1px solid var(--border-strong);
        color: var(--text-muted);
      }
      .pill.on {
        color: var(--accent);
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .reset {
        margin-left: auto;
        appearance: none;
        border: 1px solid var(--border-strong);
        background: var(--surface-elevated);
        color: var(--text);
        border-radius: var(--radius-sm);
        font: inherit;
        font-size: var(--text-2xs);
        padding: var(--space-1) var(--space-4);
        cursor: pointer;
      }
      .reset:hover {
        background: var(--surface-hover);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      td {
        padding: var(--space-3) var(--space-5);
        vertical-align: middle;
      }
      tr:not(:last-child) td {
        border-bottom: 1px solid var(--border);
      }
      .key {
        color: var(--text-muted);
        white-space: nowrap;
        width: 1%;
      }
      .val {
        color: var(--text);
        font-family: var(--font-mono);
      }
      .env {
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: var(--text-2xs);
      }
      .ovr {
        color: var(--warning);
        font-size: var(--text-2xs);
        margin-left: var(--space-3);
        vertical-align: middle;
      }
      label.toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--space-3);
        cursor: pointer;
        vertical-align: middle;
      }
      input,
      select {
        accent-color: var(--accent);
        font: inherit;
        font-family: var(--font-mono);
        vertical-align: middle;
      }
      select {
        background: var(--surface-elevated);
        color: var(--text);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        padding: 1px var(--space-2);
      }
      .row-disabled {
        opacity: 0.5;
      }
      .empty {
        color: var(--text-muted);
        padding: var(--space-3) var(--space-5);
      }
      .empty code {
        color: var(--accent);
        font-family: var(--font-mono);
      }
      .loading {
        color: var(--text-muted);
      }
    `,
  ];

  @state() private _settings: FeatureSettings | null = null;
  @state() private _override: SettingsOverride = {};
  @state() private _loaded = false;
  @state() private _theme: ThemePreference = 'auto';

  override connectedCallback() {
    super.connectedCallback();
    this._override = this._readOverride();
    this._theme = this._readTheme();
    this._applyTheme(this._theme);
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

  private _readTheme(): ThemePreference {
    try {
      const raw = localStorage.getItem(THEME_LS_KEY);
      if (raw === 'auto' || raw === 'dark' || raw === 'light') return raw;
    } catch {
      // ignore
    }
    return 'auto';
  }

  private _applyTheme(theme: ThemePreference): void {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light' || theme === 'dark') {
      root.classList.add('theme-' + theme);
    }
  }

  private _setTheme(theme: ThemePreference): void {
    this._theme = theme;
    this._applyTheme(theme);
    try {
      localStorage.setItem(THEME_LS_KEY, theme);
    } catch {
      // ignore
    }
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
          sourceOverlayEditor: s.sourceOverlay.editor,
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
    return overridden ? html`<span class="ovr">(overridden)</span>` : nothing;
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

  private _renderAppearance() {
    return html`
      <section>
        <h3>Appearance</h3>
        <table>
          <tr>
            <td class="key">theme</td>
            <td class="val">
              <select
                @change=${(e: Event) =>
                  this._setTheme(
                    (e.target as HTMLSelectElement).value as ThemePreference
                  )}
              >
                ${(
                  [
                    ['auto', 'Auto'],
                    ['dark', 'Dark'],
                    ['light', 'Light'],
                  ] as Array<[ThemePreference, string]>
                ).map(
                  ([value, label]) =>
                    html`<option
                      value=${value}
                      ?selected=${this._theme === value}
                    >
                      ${label}
                    </option>`
                )}
              </select>
            </td>
          </tr>
        </table>
      </section>
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
              @change=${(e: Event) =>
                this._set(
                  'hmrOnIncompatible',
                  (e.target as HTMLSelectElement).value as 'reload' | 'warn'
                )}
            >
              <option value="reload" ?selected=${onIncompatible === 'reload'}>
                reload
              </option>
              <option value="warn" ?selected=${onIncompatible === 'warn'}>
                warn
              </option>
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
    const appearance = this._renderAppearance();
    if (s === null) {
      return html`${appearance}
        <p class="empty">Settings unavailable.</p>`;
    }
    const hasOverride = Object.keys(this._override).length > 0;
    return html`
      <p class="note">
        Resolved from plugin options and <code>LIT_PLUGIN_*</code> env at
        startup. Controls below override the running app live; the rest are
        config-time (change them in your Vite config / <code>.env</code> and
        restart).
        ${hasOverride
          ? html`<button class="reset" @click=${this._reset}>
              Reset to env
            </button>`
          : nothing}
      </p>

      ${appearance}

      <section>
        <h3>HMR ${this._pill(s.hmr.enabled)}</h3>
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
              <tr>
                <td class="key">editor</td>
                <td class="val">
                  <select
                    @change=${(e: Event) =>
                      this._set(
                        'sourceOverlayEditor',
                        (e.target as HTMLSelectElement).value
                      )}
                  >
                    ${SOURCE_OVERLAY_EDITORS.map(
                      (ed) =>
                        html`<option
                          value=${ed.value}
                          ?selected=${ed.value ===
                          (this._override.sourceOverlayEditor ??
                            s.sourceOverlay.editor)}
                        >
                          ${ed.label}
                        </option>`
                    )}
                  </select>
                  ${this._ovr(this._override.sourceOverlayEditor !== undefined)}
                </td>
              </tr>
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
