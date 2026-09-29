/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {tokens} from '../lib/tokens.js';
import {
  readColorSchemePreference,
  setColorSchemePreference,
  type ColorSchemePreference,
} from '../lib/color-scheme.js';
import {
  SOURCE_OVERLAY_EDITORS,
  type FeatureSettings,
  type OverrideBaselines,
  type SettingSources,
  type SettingsOverride,
} from '../types/timeline.js';
import {baselineChanged} from '../lib/override-baselines.js';
import {getMeta, litRpc, type LitClient} from './client.js';
import {
  adoptOverride,
  commitOverride,
  dropOverrideKey,
  onOverrideChange,
  keepBaseline,
  readBaselines,
  readOverride,
  resetOverride,
} from './settings-override.js';

/** Settings a panel override can replace and that have a config baseline. */
type OverridableKey =
  | 'hmrReconnect'
  | 'hmrOnIncompatible'
  | 'hmrIndicatorVisible'
  | 'hmrIndicatorCount'
  | 'sourceOverlayEditor';

/** The settings this panel persists, as `DevframeSettingsRegistry.lit`. */
type LitSettings = Awaited<ReturnType<LitClient['settings']['global']['all']>>;

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
        padding: var(--lit-devtools-space-5) var(--lit-devtools-space-6);
        font-size: var(--lit-devtools-text-xs);
        line-height: var(--lit-devtools-leading-normal);
      }
      .note {
        color: var(--lit-devtools-text-muted);
        margin: 0 0 var(--lit-devtools-space-5);
      }
      .note code {
        color: var(--lit-devtools-accent);
        font-family: var(--lit-devtools-font-mono);
      }
      section {
        border: 1px solid var(--lit-devtools-border);
        border-radius: var(--lit-devtools-radius-md);
        margin-bottom: var(--lit-devtools-space-5);
        overflow: hidden;
      }
      h3 {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-4);
        margin: 0;
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        font-size: var(--lit-devtools-text-xs);
        background: var(--lit-devtools-surface-low);
        border-bottom: 1px solid var(--lit-devtools-border);
      }
      .pill {
        font-size: var(--lit-devtools-text-2xs);
        font-weight: var(--lit-devtools-weight-semibold);
        text-transform: uppercase;
        letter-spacing: var(--lit-devtools-tracking-caps);
        padding: 1px var(--lit-devtools-space-4);
        border-radius: var(--lit-devtools-radius-pill);
        border: 1px solid var(--lit-devtools-border-strong);
        color: var(--lit-devtools-text-muted);
      }
      .pill.on {
        color: var(--lit-devtools-accent);
        border-color: var(--lit-devtools-accent);
        background: var(--lit-devtools-accent-soft);
      }
      .reset {
        margin-left: auto;
        appearance: none;
        border: 1px solid var(--lit-devtools-border-strong);
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text);
        border-radius: var(--lit-devtools-radius-sm);
        font: inherit;
        font-size: var(--lit-devtools-text-2xs);
        padding: var(--lit-devtools-space-1) var(--lit-devtools-space-4);
        cursor: pointer;
      }
      .reset:hover {
        background: var(--lit-devtools-surface-hover);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      td {
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        vertical-align: middle;
      }
      tr:not(:last-child) td {
        border-bottom: 1px solid var(--lit-devtools-border);
      }
      .key {
        color: var(--lit-devtools-text-muted);
        white-space: nowrap;
        width: 1%;
      }
      .val {
        color: var(--lit-devtools-text);
        font-family: var(--lit-devtools-font-mono);
      }
      .env {
        color: var(--lit-devtools-text-muted);
        font-family: var(--lit-devtools-font-mono);
        font-size: var(--lit-devtools-text-2xs);
      }
      .ovr {
        color: var(--lit-devtools-warning);
        font-size: var(--lit-devtools-text-2xs);
        margin-left: var(--lit-devtools-space-3);
        vertical-align: middle;
      }
      .src {
        margin-left: var(--lit-devtools-space-3);
        vertical-align: middle;
      }
      .row-reset {
        appearance: none;
        border: 1px solid var(--lit-devtools-border-strong);
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text-muted);
        border-radius: var(--lit-devtools-radius-sm);
        font: inherit;
        font-size: var(--lit-devtools-text-2xs);
        line-height: 1;
        padding: 1px var(--lit-devtools-space-2);
        margin-left: var(--lit-devtools-space-3);
        vertical-align: middle;
        cursor: pointer;
      }
      .row-reset:hover {
        background: var(--lit-devtools-surface-hover);
        color: var(--lit-devtools-text);
      }
      .nudge {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--lit-devtools-space-3);
        margin-top: var(--lit-devtools-space-2);
        color: var(--lit-devtools-warning);
        font-family: inherit;
        font-size: var(--lit-devtools-text-2xs);
      }
      .nudge button {
        appearance: none;
        border: 1px solid var(--lit-devtools-border-strong);
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text);
        border-radius: var(--lit-devtools-radius-sm);
        font: inherit;
        line-height: 1;
        padding: 1px var(--lit-devtools-space-3);
        cursor: pointer;
      }
      .nudge button:hover {
        background: var(--lit-devtools-surface-hover);
      }
      label.toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--lit-devtools-space-3);
        cursor: pointer;
        vertical-align: middle;
      }
      input,
      select {
        accent-color: var(--lit-devtools-accent);
        font: inherit;
        font-family: var(--lit-devtools-font-mono);
        vertical-align: middle;
      }
      select {
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text);
        border: 1px solid var(--lit-devtools-border-strong);
        border-radius: var(--lit-devtools-radius-sm);
        padding: 1px var(--lit-devtools-space-2);
      }
      .row-disabled {
        opacity: 0.5;
      }
      .empty {
        color: var(--lit-devtools-text-muted);
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
      }
      .empty code {
        color: var(--lit-devtools-accent);
        font-family: var(--lit-devtools-font-mono);
      }
      .loading {
        color: var(--lit-devtools-text-muted);
      }
    `,
  ];

  @state() private _settings: FeatureSettings | null = null;
  @state() private _override: SettingsOverride = {};
  @state() private _recorded: OverrideBaselines = {};
  @state() private _loaded = false;
  @state() private _colorScheme: ColorSchemePreference = 'auto';

  private _unsubscribeOverride: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    // Synchronous first, from `localStorage`, so the tab paints the right
    // values (and the panel the right scheme) with no flash. `_hydrate()`
    // then reconciles against the durable store, which is what makes these
    // preferences survive a different browser or cleared site data.
    this._override = readOverride();
    this._recorded = readBaselines();
    // Other tabs (Components' Flash button) flip overrides too; stay in sync.
    this._unsubscribeOverride = onOverrideChange((o) => {
      this._override = o;
      this._recorded = readBaselines();
    });
    this._colorScheme = readColorSchemePreference();
    void this._fetch();
    void this._hydrate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeOverride?.();
    this._unsubscribeOverride = null;
  }

  /**
   * Adopt the persisted preferences from devframe's per-user settings store,
   * letting them win over this browser's `localStorage` copy.
   *
   * `global`, not `project`: in `devframe@1.0.0` the `project` store lives in
   * `<workspaceRoot>/node_modules/.<app>/devframe` (private per checkout, and
   * wiped by a clean install), while `global` is per-user, which is what "my
   * editor", "my color scheme", "how I like HMR to behave" actually are.
   * Project-wide defaults already have a home: the committed `litPlugin({...})`
   * config.
   *
   * Subscribes rather than reading once. The client-side store is a mirror of
   * a shared state, and it is empty until the first sync arrives -- a `get()`
   * issued right after connecting reads `undefined` even when the server has
   * a value on disk. `onChange` gets the first sync as an update; the `all()`
   * below covers a sync that landed before the subscription did.
   *
   * Never throws: without a hub the panel just keeps its `localStorage`
   * values.
   */
  private async _hydrate(): Promise<void> {
    try {
      const {settings} = await litRpc();
      await settings.global.onChange((all) => this._adopt(all));
      this._adopt(await settings.global.all());
    } catch {
      // dev tool — a missing or unreachable settings store is not an error
    }
  }

  /**
   * Apply a settings snapshot. Both branches no-op when the value already
   * matches, which is what stops `_adopt` -> `commitOverride` -> store write ->
   * `onChange` -> `_adopt` from looping.
   */
  private _adopt(all: Readonly<LitSettings>): void {
    const {appearance, override, overrideBaselines} = all;
    if (appearance !== undefined && appearance !== this._colorScheme) {
      this._colorScheme = appearance;
      setColorSchemePreference(appearance);
    }
    if (
      override !== undefined &&
      (JSON.stringify(override) !== JSON.stringify(this._override) ||
        JSON.stringify(overrideBaselines ?? {}) !==
          JSON.stringify(readBaselines()))
    ) {
      // Mirrors to the page and `localStorage` without writing back to the
      // store the value just came from; `_override` updates via the listener.
      // The baselines come along so a second browser judges "config changed"
      // against what the first one recorded.
      adoptOverride(override, overrideBaselines ?? {});
    }
  }

  /** Write one preference through to the durable store, best-effort. */
  private _persist<K extends keyof LitSettings>(
    key: K,
    value: LitSettings[K] | undefined
  ): void {
    litRpc()
      .then((rpc) =>
        value === undefined
          ? rpc.settings.global.delete(key)
          : rpc.settings.global.set(key, value)
      )
      .catch(() => {
        // dev tool — ignore connection/call errors
      });
  }

  private _setColorScheme(scheme: ColorSchemePreference): void {
    this._colorScheme = scheme;
    // `localStorage` first and synchronously: it applies the class right
    // away, and is what the panel reads before its first paint next time.
    setColorSchemePreference(scheme);
    this._persist('appearance', scheme);
  }

  private async _fetch() {
    try {
      const meta = await getMeta();
      this._settings = meta.features;
    } catch {
      this._settings = null;
    } finally {
      this._loaded = true;
    }
  }

  private _set<K extends keyof SettingsOverride>(
    key: K,
    value: SettingsOverride[K]
  ) {
    // Remember the config value this override was made against, so a later
    // change to `.env` or the plugin options can be pointed out.
    const s = this._settings;
    const baselines = readBaselines();
    if (s !== null && key in this._baselines(s)) {
      baselines[key as OverridableKey] =
        this._baselines(s)[key as OverridableKey];
    }
    commitOverride({...this._override, [key]: value}, baselines);
  }

  /** The resolved config value of every overridable setting. */
  private _baselines(
    s: FeatureSettings
  ): Required<Pick<SettingsOverride, OverridableKey>> {
    return {
      hmrReconnect: s.hmr.reconnect,
      hmrOnIncompatible: s.hmr.onIncompatible,
      hmrIndicatorVisible: s.hmr.indicatorEnabled,
      hmrIndicatorCount: s.hmr.indicatorCount,
      sourceOverlayEditor: s.sourceOverlay.editor,
    };
  }

  /** Clear overrides and revert the runtime to the resolved env values. */
  private _reset() {
    const s = this._settings;
    // The env values go along so the live runtime reverts now (an empty
    // override would leave the current live values in place). Preferences
    // with no config baseline revert to off.
    resetOverride(
      s === null
        ? undefined
        : ({
            ...this._baselines(s),
            flashUpdates: false,
            flashUpdatesRamp: false,
            chromeTracks: false,
          } satisfies SettingsOverride)
    );
  }

  /** Drop one overridden setting, reverting it (live) to its baseline. */
  private _resetKey(key: OverridableKey) {
    const s = this._settings;
    if (s === null) return;
    dropOverrideKey(key, this._baselines(s)[key]);
  }

  private _pill(on: boolean) {
    return html`<span class="pill ${on ? 'on' : ''}"
      >${on ? 'enabled' : 'disabled'}</span
    >`;
  }

  /**
   * Origin badge behind a value, from the server-side provenance:
   * "(env)", "(option)" or "(default)". Nothing when the server sent none.
   */
  private _source(key: keyof SettingSources) {
    const src = this._settings?.sources?.[key];
    return src ? html`<span class="env src">(${src})</span>` : nothing;
  }

  /**
   * Badge for an overridable row. Without an override it's the plain origin
   * badge; with one it's "(overridden)", the baseline it replaced
   * ("env: Zed") and a reset for just this row. `baseline` is the config
   * value as the row displays it, `fmt` renders a recorded raw value the same
   * way. When the config value moved since the override was made, a second
   * line says so and offers Reset or Keep.
   */
  private _ovrSource(
    key: OverridableKey,
    baseline: string,
    fmt: (value: unknown) => string = String
  ) {
    if (this._override[key] === undefined) return this._source(key);
    const src = this._settings?.sources?.[key] ?? 'config';
    const s = this._settings;
    const current = s === null ? undefined : this._baselines(s)[key];
    const changed = baselineChanged(key, this._recorded[key], current);
    return html`<span class="ovr">(overridden)</span>
      <span class="env">${src}: ${baseline}</span>
      <button
        class="row-reset"
        title="Reset to the ${src} value"
        aria-label="Reset to the ${src} value"
        @click=${() => this._resetKey(key)}
      >
        ×
      </button>
      ${
        changed
          ? html`<div class="nudge" data-nudge=${key}>
              <span
                >Config changed since you overrode this: was
                ${fmt(this._recorded[key])}, now ${baseline}</span
              >
              <button @click=${() => this._resetKey(key)}>Reset</button>
              <button @click=${() => keepBaseline(key, current)}>Keep</button>
            </div>`
          : nothing
      }`;
  }

  private _readonlyRow(
    key: string,
    value: unknown,
    env?: string,
    source?: keyof SettingSources
  ) {
    return html`
      <tr>
        <td class="key">${key}</td>
        <td class="val">
          ${String(value)} ${source ? this._source(source) : nothing}
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
            <td class="key">color scheme</td>
            <td class="val">
              <select
                @change=${(e: Event) =>
                  this._setColorScheme(
                    (e.target as HTMLSelectElement)
                      .value as ColorSchemePreference
                  )}
              >
                ${(
                  [
                    ['auto', 'Auto'],
                    ['dark', 'Dark'],
                    ['light', 'Light'],
                  ] as Array<[ColorSchemePreference, string]>
                ).map(
                  ([value, label]) =>
                    html`<option
                      value=${value}
                      ?selected=${this._colorScheme === value}
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
            ${this._ovrSource(
              'hmrReconnect',
              s.hmr.reconnect ? 'on' : 'off',
              (v) => (v ? 'on' : 'off')
            )}
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
            ${this._ovrSource('hmrOnIncompatible', s.hmr.onIncompatible)}
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
              ${
                s.hmr.indicatorEnabled
                  ? indicatorVisible
                    ? 'shown'
                    : 'hidden'
                  : 'off (config)'
              }
            </label>
            ${this._ovrSource(
              'hmrIndicatorVisible',
              s.hmr.indicatorEnabled ? 'shown' : 'off (config)',
              (v) => (v ? 'shown' : 'off (config)')
            )}
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
            ${this._ovrSource(
              'hmrIndicatorCount',
              s.hmr.indicatorCount ? 'shown' : 'hidden',
              (v) => (v ? 'shown' : 'hidden')
            )}
          </td>
        </tr>
      </table>
    `;
  }

  /**
   * The editor select. A custom `EditorConfig` object (reported as
   * `'custom'`) isn't one of the built-in choices, so the select is disabled
   * and just shows "Custom".
   */
  private _renderEditorRow(s: FeatureSettings) {
    const baseline = s.sourceOverlay.editor;
    const custom = baseline === 'custom';
    const current = this._override.sourceOverlayEditor ?? baseline;
    const editorLabel = (value: string) =>
      SOURCE_OVERLAY_EDITORS.find((ed) => ed.value === value)?.label ??
      (value === 'custom' ? 'Custom' : value);
    const label = editorLabel(baseline);
    return html`
      <tr>
        <td class="key">editor</td>
        <td class="val">
          <select
            ?disabled=${custom}
            @change=${(e: Event) =>
              this._set(
                'sourceOverlayEditor',
                (e.target as HTMLSelectElement).value
              )}
          >
            ${
              custom
                ? html`<option value="custom" selected>Custom</option>`
                : SOURCE_OVERLAY_EDITORS.map(
                    (ed) =>
                      html`<option
                        value=${ed.value}
                        ?selected=${ed.value === current}
                      >
                        ${ed.label}
                      </option>`
                  )
            }
          </select>
          ${this._ovrSource('sourceOverlayEditor', label, (v) =>
            editorLabel(String(v))
          )}
        </td>
      </tr>
    `;
  }

  /**
   * Page-overlay preferences for the Components tab. Pure preferences, no
   * config-time baseline, so an unset value simply means off and the
   * "overridden" marker never applies.
   */
  private _renderComponents() {
    const o = this._override;
    const flash = o.flashUpdates ?? false;
    const ramp = o.flashUpdatesRamp ?? false;
    return html`
      <table>
        <tr>
          <td class="key">flash updates</td>
          <td class="val">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${flash}
                @change=${(e: Event) =>
                  this._set(
                    'flashUpdates',
                    (e.target as HTMLInputElement).checked
                  )}
              />
              ${flash ? 'on' : 'off'}
            </label>
          </td>
        </tr>
        <tr class=${flash ? '' : 'row-disabled'}>
          <td class="key">colour by frequency</td>
          <td class="val">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${ramp}
                ?disabled=${!flash}
                @change=${(e: Event) =>
                  this._set(
                    'flashUpdatesRamp',
                    (e.target as HTMLInputElement).checked
                  )}
              />
              ${ramp ? 'calm → hot' : 'single colour'}
            </label>
          </td>
        </tr>
      </table>
    `;
  }

  /**
   * Timeline preferences. Pure preference, no config-time baseline, so an
   * unset value means off.
   */
  private _renderTimelinePrefs() {
    const chrome = this._override.chromeTracks ?? false;
    return html`
      <table>
        <tr>
          <td class="key">chrome performance tracks</td>
          <td class="val">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${chrome}
                @change=${(e: Event) =>
                  this._set(
                    'chromeTracks',
                    (e.target as HTMLInputElement).checked
                  )}
              />
              ${chrome ? 'on' : 'off'}
            </label>
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
        ${
          hasOverride
            ? html`<button class="reset" @click=${this._reset}>
                Reset to env
              </button>`
            : nothing
        }
      </p>

      ${appearance}

      <section>
        <h3>HMR ${this._pill(s.hmr.enabled)}</h3>
        ${this._renderHmr(s)}
      </section>

      <section>
        <h3>Source Overlay ${this._pill(s.sourceOverlay.enabled)}</h3>
        ${
          s.sourceOverlay.enabled
            ? html`<table>
                ${this._readonlyRow(
                  'hotkey',
                  `Ctrl+Shift+${s.sourceOverlay.key.toUpperCase()}`,
                  'LIT_PLUGIN_SOURCE_OVERLAY_KEY',
                  'sourceOverlayKey'
                )}
                ${this._renderEditorRow(s)}
                ${this._readonlyRow(
                  'throttle (ms)',
                  s.sourceOverlay.throttleMs,
                  'LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS',
                  'sourceOverlayThrottleMs'
                )}
              </table>`
            : html`<p class="empty">
                Enable with <code>sourceOverlay: true</code> or
                <code>LIT_PLUGIN_SOURCE_OVERLAY=true</code>.
              </p>`
        }
      </section>

      <section>
        <h3>Components ${this._pill(s.timeline)}</h3>
        ${
          s.timeline
            ? this._renderComponents()
            : html`<p class="empty">
                Needs the timeline runtime: enable with
                <code>timeline: true</code> or
                <code>LIT_PLUGIN_TIMELINE=true</code>.
              </p>`
        }
      </section>

      <section>
        <h3>Timeline ${this._pill(s.timeline)}</h3>
        <p class="empty">
          Layers and recording are controlled in the Timeline tab.
        </p>
        ${s.timeline ? this._renderTimelinePrefs() : nothing}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'devtools-settings': DevtoolsSettings;
  }
}
