import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/card/card.js';
import './wa-icons.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import type WaSelect from '@awesome.me/webawesome/dist/components/select/select.js';
import type WaSwitch from '@awesome.me/webawesome/dist/components/switch/switch.js';
import {tokens} from '../lib/tokens.js';
import {waSquare} from './wa-square.js';
import type {ColorSchemePreference} from '../lib/color-scheme.js';
import {
  type FeatureSettings,
  type OverrideBaselines,
  type SettingsOverride,
} from '../types/timeline.js';
import {
  SETTINGS,
  type SettingKey,
  type SettingKeyOf,
} from '../lib/setting-definitions.js';
import {presentationOf} from './setting-presentation.js';
import {settingRow, type SettingRow} from './setting-rows.js';
import {getMeta, litSettingsRpc, type LitClient} from './client.js';
import type {LitGetMetaResult} from '../lib/devframe/protocol.js';
import type {OverridableKey} from '../lib/settings-override.js';
import {overrides} from './settings-override.js';

/** The guide section that shows where the Lit tracks appear in Chrome. */
const CHROME_TRACKS_DOCS =
  'https://oddcelot.github.io/vite-plugin-lit/guides/devtools/timeline/#see-it-in-chromes-performance-panel';

/** A feature switch: shown in a section header, never overridden. */
type FeatureKey = SettingKeyOf<'feature'>;

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
    waSquare,
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
        margin-bottom: var(--lit-devtools-space-5);
      }
      wa-card {
        --spacing: 0;
      }
      wa-card::part(header) {
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
      }
      h3 {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-4);
        margin: 0;
        font-size: var(--lit-devtools-text-xs);
      }
      .reset {
        display: block;
        width: fit-content;
        margin-top: var(--wa-space-xs);
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
      .key[data-tip] {
        cursor: help;
        text-decoration: underline dotted;
        text-underline-offset: 3px;
      }
      .opt-src {
        opacity: 0.7;
        font-size: var(--lit-devtools-text-2xs);
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
      wa-badge.env {
        font-family: var(--lit-devtools-font-mono);
        vertical-align: middle;
      }
      .src {
        margin-left: var(--lit-devtools-space-3);
        vertical-align: middle;
      }
      .docs-link {
        margin-left: var(--lit-devtools-space-3);
        vertical-align: middle;
      }
      .row-reset {
        margin-left: var(--lit-devtools-space-3);
        vertical-align: middle;
      }
      .nudge {
        display: block;
        margin-top: var(--lit-devtools-space-2);
        font-size: var(--lit-devtools-text-2xs);
      }
      wa-switch,
      wa-select {
        vertical-align: middle;
      }
      wa-select {
        display: inline-block;
        min-width: 9em;
        font-family: var(--lit-devtools-font-mono);
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
  @state() private _meta: LitGetMetaResult | null = null;
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
    this._override = overrides.get();
    this._recorded = overrides.baselines();
    // Other tabs (Components' Flash button) flip overrides too; stay in sync.
    this._unsubscribeOverride = overrides.subscribe((o) => {
      this._override = o;
      this._recorded = overrides.baselines();
    });
    this._colorScheme = overrides.appearance();
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
      const {settings} = await litSettingsRpc();
      await settings.global.onChange((all) => this._adopt(all));
      this._adopt(await settings.global.all());
    } catch {
      // dev tool — a missing or unreachable settings store is not an error
    }
  }

  /** Apply a settings snapshot from the durable store. */
  private _adopt(all: Readonly<LitSettings>): void {
    const {appearance, override, overrideBaselines} = all;
    // Mirrors to the page and `localStorage` without writing back to the
    // store the value just came from; `_override` updates via the listener.
    // The baselines come along so a second browser judges "config changed"
    // against what the first one recorded. A snapshot that already matches is
    // a no-op, which is what stops the adopt -> store write -> `onChange` ->
    // adopt loop.
    overrides.adopt({override, overrideBaselines, appearance});
    this._colorScheme = overrides.appearance();
  }

  private _setColorScheme(scheme: ColorSchemePreference): void {
    this._colorScheme = scheme;
    // `localStorage` first and synchronously: it applies the class right
    // away, and is what the panel reads before its first paint next time.
    overrides.setAppearance(scheme);
  }

  private async _fetch() {
    try {
      const meta = await getMeta();
      this._settings = meta.features;
      this._meta = meta;
    } catch {
      this._settings = null;
      this._meta = null;
    } finally {
      this._loaded = true;
    }
  }

  private _set<K extends keyof SettingsOverride>(
    key: K,
    value: SettingsOverride[K]
  ) {
    // The module records the config value this override was made against, so
    // a later change to `.env` or the plugin options can be pointed out.
    overrides.set(key, value, this._settings ?? undefined);
  }

  /** Clear overrides and revert the runtime to the resolved env values. */
  private _reset() {
    overrides.reset(this._settings ?? undefined);
  }

  /** Drop one overridden setting, reverting it (live) to its baseline. */
  private _resetKey(key: OverridableKey) {
    const s = this._settings;
    if (s === null) return;
    overrides.resetKey(key, s);
  }

  private _pill(on: boolean) {
    return html`<wa-badge
      class="pill ${on ? 'on' : ''}"
      size="small"
      variant=${on ? 'success' : 'neutral'}
      >${on ? 'enabled' : 'disabled'}</wa-badge
    >`;
  }

  /**
   * A section header's on/off pill for a feature switch, with the origin
   * badge saying whether an option or env turned it on or off.
   */
  private _feature(key: FeatureKey) {
    const row = this._rowOf(key);
    return html`${this._pill(row.value === true)} ${this._badge(row)}`;
  }

  /** How to turn a feature on, naming its plugin option and env var. */
  private _enableHint(key: FeatureKey, lead = 'Enable with') {
    return html`<p class="empty">
      ${lead} <code>${presentationOf(key).option}: true</code> or
      <code>${SETTINGS[key].env}=true</code>.
    </p>`;
  }

  private _rowOf(key: SettingKey): SettingRow {
    return settingRow(key, {
      config: this._settings,
      override: this._override,
      recorded: this._recorded,
      chromeTracks: this._meta?.runtime.chromeTracks,
    });
  }

  /**
   * Badge behind a row's value. Without an override it's the plain origin
   * badge, "(env)" or "(option)", and nothing for a built-in default, which
   * is most rows and would only be noise. With one it's the baseline it
   * replaced ("env: Zed"), in the brand colour, and a reset for just this
   * row. When the config value moved since the override was made, a second
   * line says so and offers Reset or Keep.
   */
  private _badge(row: SettingRow) {
    const {override} = row;
    if (!override) {
      return row.origin && row.origin !== 'default'
        ? html`<wa-badge
            class="env src"
            size="small"
            appearance="outlined"
            variant="neutral"
            >(${row.origin})</wa-badge
          >`
        : nothing;
    }
    const key = row.key as OverridableKey;
    const src = override.source;
    const s = this._settings;
    return html`<wa-badge
        class="env src ovr"
        size="small"
        appearance="outlined"
        variant="brand"
        >${src}: ${override.baseline}</wa-badge
      >
      <wa-button
        class="row-reset"
        appearance="plain"
        size="small"
        aria-label="Reset to the ${src} value"
        data-tip="Reset to the ${src} value"
        @click=${() => this._resetKey(key)}
      >
        <wa-icon name="x" label="Reset to the ${src} value"></wa-icon>
      </wa-button>
      ${
        override.moved
          ? html`<wa-callout
              class="nudge"
              data-nudge=${key}
              variant="warning"
              size="small"
            >
              <span
                >Config changed since you overrode this: was
                ${override.moved.was}, now ${override.moved.now}</span
              >
              <wa-button
                size="small"
                data-tip="Discard your override and use the new ${src} value"
                @click=${() => this._resetKey(key)}
                >Reset</wa-button
              >
              <wa-button
                size="small"
                data-tip="Keep your override and stop flagging the config change"
                @click=${() => s !== null && overrides.keep(key, s)}
              >
                Keep
              </wa-button>
            </wa-callout>`
          : nothing
      }`;
  }

  /** A row's control: a switch, a select, or the value as text. */
  private _control(row: SettingRow) {
    const set = (value: unknown) =>
      this._set(row.key as keyof SettingsOverride, value as never);
    switch (row.definition.kind) {
      case 'switch':
        return html`<wa-switch
          size="small"
          .checked=${row.value === true}
          ?disabled=${row.disabled}
          @change=${(e: Event) => set((e.target as WaSwitch).checked)}
        >
          ${row.text}
        </wa-switch>`;
      case 'select':
        return html`<wa-select
          size="small"
          .value=${String(row.value)}
          ?disabled=${row.disabled}
          @change=${(e: Event) => set((e.target as WaSelect).value)}
        >
          ${row.options?.map(
            (option) =>
              html`<wa-option
                value=${String(option.value)}
                .label=${option.text}
                >${option.text}${
                  option.marker
                    ? html`<span slot="end" class="opt-src"
                        >${option.marker}</span
                      >`
                    : nothing
                }</wa-option
              >`
          )}
        </wa-select>`;
      default:
        return html`${row.text}`;
    }
  }

  /** One Setting's row. `after` trails the value, such as a docs link. */
  private _row(key: SettingKey, after: unknown = nothing) {
    const row = this._rowOf(key);
    return html`
      <tr class=${row.disabled ? 'row-disabled' : ''}>
        <td class="key" data-tip=${row.tip}>${row.label}</td>
        <td class="val">
          ${this._control(row)} ${this._badge(row)}
          ${
            row.definition.role === 'readonly'
              ? html`<span class="env">${row.definition.env}</span>`
              : nothing
          }
          ${after}
        </td>
      </tr>
    `;
  }

  private _renderAppearance() {
    return html`
      <section>
        <wa-card>
          <h3 slot="header">Appearance</h3>
          <table>
            <tr>
              <td
                class="key"
                data-tip="Light or dark panel. Auto follows the system. Default: Auto"
              >
                color scheme
              </td>
              <td class="val">
                <wa-select
                  size="small"
                  .value=${this._colorScheme}
                  @change=${(e: Event) =>
                    this._setColorScheme(
                      (e.target as WaSelect).value as ColorSchemePreference
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
                      html`<wa-option value=${value} .label=${label}
                        >${label}${
                          value === 'auto'
                            ? html`<span slot="end" class="opt-src"
                                >default</span
                              >`
                            : nothing
                        }</wa-option
                      >`
                  )}
                </wa-select>
              </td>
            </tr>
          </table>
        </wa-card>
      </section>
    `;
  }

  private _renderHmr(s: FeatureSettings) {
    if (!s.hmr.enabled) return this._enableHint('hmr');
    return html`
      <table>
        ${this._row('hmrReconnect')} ${this._row('hmrOnIncompatible')}
        ${this._row('hmrChildState')} ${this._row('hmrIndicatorVisible')}
        ${this._row('hmrIndicatorCount')}
      </table>
    `;
  }

  /**
   * The editor select. A custom `EditorConfig` object (reported as
   * `'custom'`) isn't one of the built-in choices, so the select is disabled
   * and just shows "Custom".
   */
  private _renderEditorRow(s: FeatureSettings) {
    if (s.sourceOverlay.editor !== 'custom') {
      return this._row('sourceOverlayEditor');
    }
    const row = this._rowOf('sourceOverlayEditor');
    return html`
      <tr>
        <td class="key" data-tip=${row.tip}>${row.label}</td>
        <td class="val">
          <wa-select size="small" disabled .value=${'custom'}>
            <wa-option value="custom" disabled>Custom</wa-option>
          </wa-select>
          ${this._badge(row)}
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
    return html`
      <table>
        ${this._row('flashUpdates')} ${this._row('flashUpdatesRamp')}
      </table>
    `;
  }

  /**
   * Timeline preferences. Pure preference, no config-time baseline, so an
   * unset value means off.
   */
  private _renderTimelinePrefs() {
    return html`
      <table>
        ${this._row(
          'chromeTracks',
          html`<wa-button
            class="docs-link"
            appearance="plain"
            size="small"
            href=${CHROME_TRACKS_DOCS}
            target="_blank"
            data-tip="Open the guide with a screenshot of the Lit tracks in Chrome"
          >
            <wa-icon slot="end" name="arrow-square-out"></wa-icon>
            Where to find them
          </wa-button>`
        )}
      </table>
    `;
  }

  /**
   * Versions, layers and picker as `get-meta` reports them: the first thing
   * to check when the panel or the Components tab looks wrong.
   */
  private _renderAbout() {
    const meta = this._meta;
    if (meta === null) return nothing;
    const packages = Object.entries(
      meta.runtime.ready ? meta.runtime.litPackages : {}
    );
    return html`
      <section>
        <wa-card>
          <h3 slot="header">About</h3>
          <table>
            <tr>
              <td class="key">plugin version</td>
              <td class="val">${meta.version}</td>
            </tr>
            ${
              packages.length === 0
                ? html`<tr>
                    <td class="key">lit</td>
                    <td class="val">not detected</td>
                  </tr>`
                : packages.map(
                    ([name, versions]) => html`<tr>
                      <td class="key">${name}</td>
                      <td class="val">
                        ${
                          versions.join(', ') +
                          (versions.length > 1 ? ' (duplicate copies)' : '')
                        }
                      </td>
                    </tr>`
                  )
            }
            <tr>
              <td class="key">timeline layers</td>
              <td class="val">${meta.layers.map((l) => l.label).join(', ')}</td>
            </tr>
            <tr>
              <td class="key">element picker</td>
              <td class="val">
                ${meta.picker ? 'available' : 'unavailable (enable sourceOverlay)'}
              </td>
            </tr>
          </table>
          <p class="note">
            Settings resolve in this order: panel override, then plugin option,
            then <code>LIT_PLUGIN_*</code> env, then default. An explicit
            <code>timeline: false</code> in the plugin options is final and
            ignores env.
          </p>
        </wa-card>
      </section>
    `;
  }

  override render() {
    if (!this._loaded) {
      return html`<p class="loading">Loading settings…</p>`;
    }
    const s = this._settings;
    const appearance = this._renderAppearance();
    if (s === null) {
      // Off the Vite plugin there are no plugin options or env to resolve;
      // saying so beats a bare "unavailable" that reads like a fault. The
      // page-side preferences still apply there: they have no config-time
      // baseline, and the runtime those hosts inject always has the timeline.
      const offPlugin = this._meta?.capabilities.pluginSettings === false;
      return html`${appearance}
        <p class="empty">
          ${
            offPlugin
              ? 'Plugin settings need the Vite plugin; this page is inspected without a Vite dev server.'
              : 'Settings unavailable.'
          }
        </p>
        ${
          offPlugin
            ? html`<section>
                  <wa-card>
                    <h3 slot="header">Components</h3>
                    ${this._renderComponents()}
                  </wa-card>
                </section>
                <section>
                  <wa-card>
                    <h3 slot="header">Timeline</h3>
                    ${this._renderTimelinePrefs()}
                  </wa-card>
                </section>`
            : nothing
        }
        ${this._renderAbout()}`;
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
            ? html`<wa-button
                class="reset"
                size="small"
                appearance="outlined"
                data-tip="Discard every override and use the env and config values"
                @click=${this._reset}
              >
                <wa-icon slot="start" name="arrow-counter-clockwise"></wa-icon>
                Reset to env
              </wa-button>`
            : nothing
        }
      </p>

      ${appearance}

      <section>
        <wa-card>
          <h3 slot="header">HMR ${this._feature('hmr')}</h3>
          ${this._renderHmr(s)}
        </wa-card>
      </section>

      <section>
        <wa-card>
          <h3 slot="header">
            Source Overlay ${this._feature('sourceOverlay')}
          </h3>
          ${
            s.sourceOverlay.enabled
              ? html`<table>
                  ${this._row('sourceOverlayKey')} ${this._renderEditorRow(s)}
                  ${this._row('sourceOverlayThrottleMs')}
                </table>`
              : this._enableHint('sourceOverlay')
          }
        </wa-card>
      </section>

      <section>
        <wa-card>
          <h3 slot="header">Components ${this._feature('timeline')}</h3>
          ${
            s.timeline
              ? this._renderComponents()
              : this._enableHint(
                  'timeline',
                  'Needs the timeline runtime: enable with'
                )
          }
        </wa-card>
      </section>

      <section>
        <wa-card>
          <h3 slot="header">Timeline ${this._feature('timeline')}</h3>
          <p class="empty">
            Layers and recording are controlled in the Timeline tab.
          </p>
          ${s.timeline ? this._renderTimelinePrefs() : nothing}
        </wa-card>
      </section>

      ${this._renderAbout()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'devtools-settings': DevtoolsSettings;
  }
}
