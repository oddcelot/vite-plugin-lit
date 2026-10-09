import {LitElement, html, css, nothing} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {tokens, injectTokens} from '../lib/tokens.js';
import {
  applyColorScheme,
  readColorSchemePreference,
} from '../lib/color-scheme.js';
import './timeline-view.js';
import {panelBrand} from './brand.js';
import {litRpc} from './client.js';
import {hostInfo} from './host.js';
import {clearTimelineEvents} from './timeline-store.js';
import type {PageChangedEvent} from '../lib/devframe/protocol.js';

// Install the shared design tokens on the panel iframe's :root before the
// views render. Panel components inherit the semantic aliases from :root.
// The panel owns this document, so it also declares `color-scheme` (host-page
// injections must not — see `injectTokens`).
injectTokens({colorScheme: true});
// Own the color-scheme class once the panel module is live: re-assert the
// saved preference (the Settings tab mounts lazily, so it can't). `auto` needs
// no JS — the tokens' `prefers-color-scheme` @media rule resolves it live.
applyColorScheme(readColorSchemePreference());
import './components-view.js';
import type {ComponentsView} from './components-view.js';
import './updates-view.js';
import {onDeepLink, writeHashLink} from './deep-link.js';
import {PanelLocation} from './panel-location.js';
import type {DeepLinkTab} from './deep-link.js';
import './devtools-settings.js';
import './segmented-tabs.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import './wa-icons.js';
import type {TabItem} from './segmented-tabs.js';

/**
 * Tabs hosted by the panel. The Timeline is the first; this list is the
 * extension point for future Lit DevTools views.
 */
const TABS: readonly TabItem[] = [
  {id: 'components', label: 'Components', icon: 'cube'},
  {id: 'updates', label: 'Updates', icon: 'notification'},
  {id: 'timeline', label: 'Timeline', icon: 'clock'},
  {id: 'settings', label: 'Settings', icon: 'gear'},
];

/** Inline Lit logo mark. */
const LIT_LOGO_SVG = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="-32 0 320 320"
  width="20"
  height="20"
  aria-hidden="true"
>
  <path
    fill="#00e8ff"
    d="m64 192l25.926-44.727l38.233-19.114l63.974 63.974l10.833 61.754L192 320l-64-64l-38.074-25.615z"
  />
  <path
    fill="#283198"
    d="M128 256V128l64-64v128zM0 256l64 64l9.202-60.602L64 192l-37.542 23.71z"
  />
  <path
    fill="#324fff"
    d="M64 192V64l64-64v128zm128 128V192l64-64v128zM0 256V128l64 64z"
  />
  <path fill="#0ff" d="M64 320V192l64 64z" />
</svg>`;

/**
 * Root of the Lit DevTools panel — a tabbed shell. Each tab's view is kept
 * mounted and merely hidden when inactive, so the Timeline keeps recording
 * (and holds its events) while another tab is in front.
 */
@customElement('lit-devtools-panel')
export class LitDevtoolsPanel extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100vh;
        font-family: var(--lit-devtools-font-sans);
        font-size: var(--lit-devtools-text-sm);
        background: var(--lit-devtools-bg);
        color: var(--lit-devtools-text);
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-6);
        padding: 0 var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        flex-shrink: 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-4);
        color: var(--lit-devtools-text-strong);
        font-weight: var(--lit-devtools-weight-bold);
        font-size: var(--lit-devtools-text-xs);
        letter-spacing: var(--lit-devtools-tracking-caps);
        text-transform: uppercase;
        padding: var(--lit-devtools-space-5) 0;
      }
      .brand svg,
      .brand img {
        display: block;
      }
      .page-changed {
        flex-shrink: 0;
        border-radius: 0;
        border-width: 0 0 1px;
        font-size: var(--wa-font-size-s);
      }
      .page-changed::part(message) {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }
      .page-changed span {
        flex: 1;
      }
      .view {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
    `,
  ];

  /**
   * Which tab is in front and what each view has selected. Deep links write
   * it, the views read and update their own slot, and the URL hash follows
   * it; the shell never reaches into a view for its selection.
   */
  private readonly _location = new PanelLocation();
  private _locationOff: (() => void) | null = null;

  /** Mirrors `ComponentsView.hmrIncompatibilityCount`; see `_onHmrCountChange`. */
  @state() private _hmrCount = 0;
  /** Distinct warned components; see `_onWarningCountChange`. */
  @state() private _warningCount = 0;

  /** The latest `page-changed` notice, until dismissed. */
  @state() private _pageChange: PageChangedEvent | null = null;

  @query('components-view') private _componentsView?: ComponentsView;

  override connectedCallback() {
    super.connectedCallback();
    this._locationOff = this._location.subscribe(() => {
      this.requestUpdate();
      this._syncHash();
    });
    void this._listenForPageChange();
  }

  /**
   * The node side follows one page at a time and says so when another takes
   * over. A frozen session has no page to follow, so nothing to listen for.
   */
  private async _listenForPageChange(): Promise<void> {
    try {
      if ((await hostInfo()).snapshot) return;
      const rpc = await litRpc();
      rpc.rpc.register({
        name: 'page-changed',
        type: 'event',
        handler: (event: PageChangedEvent) => {
          // The node dropped its buffer; the panel's own copy describes a
          // page that is no longer followed, on a different clock.
          clearTimelineEvents();
          this._componentsView?.pageChanged();
          // A reload of the same tab is not news.
          if (!event.reload) this._pageChange = event;
        },
      });
    } catch {
      // No client, no notice; the views report their own connection errors.
    }
  }

  /**
   * Tab items for the strip, badging "Components" with the current
   * HMR-incompatibility count and the number of components Lit warned about,
   * each when there is one.
   */
  private get _tabs(): readonly TabItem[] {
    if (this._hmrCount === 0 && this._warningCount === 0) return TABS;
    return TABS.map((t) =>
      t.id === 'components'
        ? {...t, badge: this._hmrCount, warnings: this._warningCount}
        : t
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._locationOff?.();
    this._locationOff = null;
  }

  private _onTabChange(e: CustomEvent<{value: string}>) {
    this._location.setTab(e.detail.value as DeepLinkTab);
  }

  /**
   * Two sources, one shape: the URL hash the panel opened with (standalone,
   * or a snapshot someone was sent) and the hub activating our dock with
   * params (another devframe, a command, or this plugin's own overlay pick).
   * The location holds a link's selection until its view can show it, so
   * nothing here waits for a view to render.
   */
  override firstUpdated() {
    onDeepLink((link) => this._location.apply(link));
  }

  /**
   * Keep the address bar pointing at what is on screen, so copying it is a
   * link. Only meaningful when the panel owns its URL — docked in the hub it
   * is an iframe nobody reads the address of, and writing there would be
   * noise.
   */
  private _syncHash(): void {
    if (window.top !== window.self) return;
    writeHashLink(this._location.link());
  }

  /**
   * A component couldn't be hot-patched in place. Passive badge only — unlike
   * an overlay pick, this must not switch tabs: an incompatibility is
   * not something the developer asked to look at.
   */
  private _onHmrCountChange(e: CustomEvent<{count: number}>) {
    this._hmrCount = e.detail.count;
  }

  /** Lit warned about this many components: a passive badge, no tab switch. */
  private _onWarningCountChange(e: CustomEvent<{count: number}>) {
    this._warningCount = e.detail.count;
  }

  /** An "inspect" link in the timeline or Updates: open Components on it. */
  private _onInspectElement(e: CustomEvent<{id: number}>) {
    this._location.apply({componentId: e.detail.id});
  }

  private _renderBrand() {
    const {name, iconUrl} = panelBrand();
    const mark =
      iconUrl === undefined
        ? LIT_LOGO_SVG
        : html`<img src=${iconUrl} width="20" height="20" alt="" />`;
    return html`<span class="brand">${mark} ${name}</span>`;
  }

  override render() {
    return html`
      <header>
        ${this._renderBrand()}
        <segmented-tabs
          .items=${this._tabs}
          .value=${this._location.tab}
          @change=${this._onTabChange}
        ></segmented-tabs>
      </header>
      ${
        this._pageChange === null
          ? nothing
          : html`<wa-callout
              class="page-changed"
              variant="warning"
              size="small"
              role="status"
            >
              <wa-icon slot="icon" name="warning"></wa-icon>
              <span
                >Another page connected at
                ${new Date(this._pageChange.at).toLocaleTimeString()} — the
                panel now follows it. The earlier recording was cleared.</span
              >
              <wa-button
                appearance="plain"
                size="small"
                aria-label="Dismiss"
                data-tip="Dismiss"
                @click=${() => (this._pageChange = null)}
              >
                <wa-icon name="x" label="Dismiss"></wa-icon>
              </wa-button>
            </wa-callout>`
      }
      <div class="view" @inspect-element=${this._onInspectElement}>
        <timeline-view
          ?hidden=${this._location.tab !== 'timeline'}
          .location=${this._location}
        ></timeline-view>
        <!-- Kept mounted (like the timeline) so an overlay inspect-pick can
             arrive and switch us here even while another tab is in front. -->
        <components-view
          ?hidden=${this._location.tab !== 'components'}
          .location=${this._location}
          @hmr-count-change=${this._onHmrCountChange}
          @warning-count-change=${this._onWarningCountChange}
        ></components-view>
        <!-- Mounted lazily: the recording it derives from lives in the
             timeline store and keeps filling whether or not this view exists,
             so there is nothing here to keep alive in the background. -->
        ${
          this._location.tab === 'updates'
            ? html`<updates-view .location=${this._location}></updates-view>`
            : nothing
        }
        ${
          this._location.tab === 'settings'
            ? html`<devtools-settings></devtools-settings>`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lit-devtools-panel': LitDevtoolsPanel;
  }
}
