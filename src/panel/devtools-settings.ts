import {LitElement, html, css, nothing} from 'lit';
import {ifDefined} from 'lit/directives/if-defined.js';
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
  SOURCE_OVERLAY_EDITORS,
  type FeatureSettings,
  type OverrideBaselines,
  type SettingSources,
  type SettingsOverride,
} from '../types/timeline.js';
import {baselineChanged} from '../lib/setting-definitions.js';
import {getMeta, litSettingsRpc, type LitClient} from './client.js';
import type {LitGetMetaResult} from '../lib/devframe/protocol.js';
import {configValues, type OverridableKey} from '../lib/settings-override.js';
import {overrides} from './settings-override.js';

/** The guide section that shows where the Lit tracks appear in Chrome. */
const CHROME_TRACKS_DOCS =
  'https://oddcelot.github.io/vite-plugin-lit/guides/devtools/timeline/#see-it-in-chromes-performance-panel';

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
   * Origin badge behind a value, from the server-side provenance: "(env)" or
   * "(option)". Nothing for a built-in default, which is most rows and would
   * only be noise, or when the server sent no provenance.
   */
  private _source(key: keyof SettingSources) {
    const src = this._settings?.sources?.[key];
    return src && src !== 'default'
      ? html`<wa-badge
          class="env src"
          size="small"
          appearance="outlined"
          variant="neutral"
          >(${src})</wa-badge
        >`
      : nothing;
  }

  /**
   * Marker trailing a select option: the config baseline names where it came
   * from, and when that was env or an option, the built-in default gets its
   * own "default" marker, so the open list shows both. Option labels come
   * from the default slot only, so the closed select doesn't repeat it.
   */
  private _optSource(
    key: keyof SettingSources,
    value: string,
    baseline: string,
    builtin: string
  ) {
    const src =
      value === baseline
        ? (this._settings?.sources?.[key] ?? 'default')
        : value === builtin
          ? 'default'
          : undefined;
    return src ? html`<span slot="end" class="opt-src">${src}</span>` : nothing;
  }

  /**
   * Badge for an overridable row. Without an override it's the plain origin
   * badge; with one it's the baseline it replaced ("env: Zed"), in the brand
   * colour, and a reset for just this row. `baseline` is the config
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
    const current = s === null ? undefined : configValues(s)[key];
    const changed = baselineChanged(key, this._recorded[key], current);
    return html`<wa-badge
        class="env src ovr"
        size="small"
        appearance="outlined"
        variant="brand"
        >${src}: ${baseline}</wa-badge
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
        changed
          ? html`<wa-callout
              class="nudge"
              data-nudge=${key}
              variant="warning"
              size="small"
            >
              <span
                >Config changed since you overrode this: was
                ${fmt(this._recorded[key])}, now ${baseline}</span
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

  private _readonlyRow(
    key: string,
    value: unknown,
    env?: string,
    source?: keyof SettingSources,
    tip?: string
  ) {
    return html`
      <tr>
        <td class="key" data-tip=${ifDefined(tip)}>${key}</td>
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
    const o = this._override;
    if (!s.hmr.enabled) {
      return html`<p class="empty">
        Enable with <code>hmr: true</code> or <code>LIT_PLUGIN_HMR=true</code>.
      </p>`;
    }
    const reconnect = o.hmrReconnect ?? s.hmr.reconnect;
    const onIncompatible = o.hmrOnIncompatible ?? s.hmr.onIncompatible;
    const childState = o.hmrChildState ?? s.hmr.childState;
    // The indicator element only exists when enabled at config time, so it can
    // be hidden/shown (and its count toggled) live but not created here.
    const indicatorVisible = o.hmrIndicatorVisible ?? s.hmr.indicatorEnabled;
    const indicatorCount = o.hmrIndicatorCount ?? s.hmr.indicatorCount;
    return html`
      <table>
        <tr>
          <td
            class="key"
            data-tip="Run disconnectedCallback and connectedCallback on live instances after a hot patch. Default: off"
          >
            reconnect
          </td>
          <td class="val">
            <wa-switch
              size="small"
              .checked=${reconnect}
              @change=${(e: Event) =>
                this._set('hmrReconnect', (e.target as WaSwitch).checked)}
            >
              ${reconnect ? 'on' : 'off'}
            </wa-switch>
            ${this._ovrSource(
              'hmrReconnect',
              s.hmr.reconnect ? 'on' : 'off',
              (v) => (v ? 'on' : 'off')
            )}
          </td>
        </tr>
        <tr>
          <td
            class="key"
            data-tip="What to do when a component can't be hot-patched in place: reload the page, or only warn. Default: reload"
          >
            on incompatible
          </td>
          <td class="val">
            <wa-select
              size="small"
              .value=${onIncompatible}
              @change=${(e: Event) =>
                this._set(
                  'hmrOnIncompatible',
                  (e.target as WaSelect).value as 'reload' | 'warn'
                )}
            >
              ${(['reload', 'warn'] as const).map(
                (mode) =>
                  html`<wa-option value=${mode} .label=${mode}
                    >${mode}${this._optSource(
                      'hmrOnIncompatible',
                      mode,
                      s.hmr.onIncompatible,
                      'reload'
                    )}</wa-option
                  >`
              )}
            </wa-select>
            ${this._ovrSource('hmrOnIncompatible', s.hmr.onIncompatible)}
          </td>
        </tr>
        <tr>
          <td
            class="key"
            data-tip="What happens to custom elements inside an edited template: transfer hands them the old properties and private state, reuse puts the old element back where it has no bindings, reset starts them fresh. Default: transfer"
          >
            child state
          </td>
          <td class="val">
            <wa-select
              size="small"
              .value=${childState}
              @change=${(e: Event) =>
                this._set(
                  'hmrChildState',
                  (e.target as WaSelect)
                    .value as FeatureSettings['hmr']['childState']
                )}
            >
              ${(['transfer', 'reuse', 'reset'] as const).map(
                (mode) =>
                  html`<wa-option value=${mode} .label=${mode}
                    >${mode}${this._optSource(
                      'hmrChildState',
                      mode,
                      s.hmr.childState,
                      'transfer'
                    )}</wa-option
                  >`
              )}
            </wa-select>
            ${this._ovrSource('hmrChildState', s.hmr.childState)}
          </td>
        </tr>
        <tr class=${s.hmr.indicatorEnabled ? '' : 'row-disabled'}>
          <td
            class="key"
            data-tip="The dot on the page that pulses on each HMR update. Default: shown"
          >
            indicator
          </td>
          <td class="val">
            <wa-switch
              size="small"
              .checked=${indicatorVisible}
              ?disabled=${!s.hmr.indicatorEnabled}
              @change=${(e: Event) =>
                this._set(
                  'hmrIndicatorVisible',
                  (e.target as WaSwitch).checked
                )}
            >
              ${
                s.hmr.indicatorEnabled
                  ? indicatorVisible
                    ? 'shown'
                    : 'hidden'
                  : 'off (config)'
              }
            </wa-switch>
            ${this._ovrSource(
              'hmrIndicatorVisible',
              s.hmr.indicatorEnabled ? 'shown' : 'off (config)',
              (v) => (v ? 'shown' : 'off (config)')
            )}
          </td>
        </tr>
        <tr class=${s.hmr.indicatorEnabled ? '' : 'row-disabled'}>
          <td
            class="key"
            data-tip="Show a running update count next to the indicator. Default: hidden"
          >
            indicator count
          </td>
          <td class="val">
            <wa-switch
              size="small"
              .checked=${indicatorCount}
              ?disabled=${!s.hmr.indicatorEnabled}
              @change=${(e: Event) =>
                this._set('hmrIndicatorCount', (e.target as WaSwitch).checked)}
            >
              ${indicatorCount ? 'shown' : 'hidden'}
            </wa-switch>
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
        <td
          class="key"
          data-tip="The editor that source links and the overlay open files in. Default: VS Code"
        >
          editor
        </td>
        <td class="val">
          <wa-select
            size="small"
            ?disabled=${custom}
            .value=${custom ? 'custom' : current}
            @change=${(e: Event) =>
              this._set(
                'sourceOverlayEditor',
                String((e.target as WaSelect).value)
              )}
          >
            ${
              custom
                ? html`<wa-option value="custom" disabled>Custom</wa-option>`
                : SOURCE_OVERLAY_EDITORS.map(
                    (ed) =>
                      html`<wa-option value=${ed.value} .label=${ed.label}
                        >${ed.label}${this._optSource(
                          'sourceOverlayEditor',
                          ed.value,
                          baseline,
                          'vscode'
                        )}</wa-option
                      >`
                  )
            }
          </wa-select>
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
          <td
            class="key"
            data-tip="Outline elements on the page each time they update. Default: off"
          >
            flash updates
          </td>
          <td class="val">
            <wa-switch
              size="small"
              .checked=${flash}
              @change=${(e: Event) =>
                this._set('flashUpdates', (e.target as WaSwitch).checked)}
            >
              ${flash ? 'on' : 'off'}
            </wa-switch>
          </td>
        </tr>
        <tr class=${flash ? '' : 'row-disabled'}>
          <td
            class="key"
            data-tip="Tint each flash by how often the element updates, from calm to hot, instead of one colour. Default: off"
          >
            colour by frequency
          </td>
          <td class="val">
            <wa-switch
              size="small"
              .checked=${ramp}
              ?disabled=${!flash}
              @change=${(e: Event) =>
                this._set('flashUpdatesRamp', (e.target as WaSwitch).checked)}
            >
              ${ramp ? 'calm → hot' : 'single colour'}
            </wa-switch>
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
          <td
            class="key"
            data-tip="Mirror the timeline into Chrome DevTools' Performance panel as a Lit track group. Default: off"
          >
            chrome performance tracks
          </td>
          <td class="val">
            <wa-switch
              size="small"
              .checked=${chrome}
              @change=${(e: Event) =>
                this._set('chromeTracks', (e.target as WaSwitch).checked)}
            >
              ${chrome ? 'on' : 'off'}
            </wa-switch>
            <wa-button
              class="docs-link"
              appearance="plain"
              size="small"
              href=${CHROME_TRACKS_DOCS}
              target="_blank"
              data-tip="Open the guide with a screenshot of the Lit tracks in Chrome"
            >
              <wa-icon slot="end" name="arrow-square-out"></wa-icon>
              Where to find them
            </wa-button>
          </td>
        </tr>
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
          <h3 slot="header">HMR ${this._pill(s.hmr.enabled)}</h3>
          ${this._renderHmr(s)}
        </wa-card>
      </section>

      <section>
        <wa-card>
          <h3 slot="header">
            Source Overlay ${this._pill(s.sourceOverlay.enabled)}
          </h3>
          ${
            s.sourceOverlay.enabled
              ? html`<table>
                  ${this._readonlyRow(
                    'hotkey',
                    `Ctrl+Shift+${s.sourceOverlay.key.toUpperCase()}`,
                    'LIT_PLUGIN_SOURCE_OVERLAY_KEY',
                    'sourceOverlayKey',
                    'Toggles the source overlay on the page. Default: Ctrl+Shift+S'
                  )}
                  ${this._renderEditorRow(s)}
                  ${this._readonlyRow(
                    'throttle (ms)',
                    s.sourceOverlay.throttleMs,
                    'LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS',
                    'sourceOverlayThrottleMs',
                    'Minimum time between overlay updates while the pointer moves. Default: 50'
                  )}
                </table>`
              : html`<p class="empty">
                  Enable with <code>sourceOverlay: true</code> or
                  <code>LIT_PLUGIN_SOURCE_OVERLAY=true</code>.
                </p>`
          }
        </wa-card>
      </section>

      <section>
        <wa-card>
          <h3 slot="header">Components ${this._pill(s.timeline)}</h3>
          ${
            s.timeline
              ? this._renderComponents()
              : html`<p class="empty">
                  Needs the timeline runtime: enable with
                  <code>timeline: true</code> or
                  <code>LIT_PLUGIN_TIMELINE=true</code>.
                </p>`
          }
        </wa-card>
      </section>

      <section>
        <wa-card>
          <h3 slot="header">Timeline ${this._pill(s.timeline)}</h3>
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
