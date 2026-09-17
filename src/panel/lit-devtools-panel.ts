/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {tokens, injectTokens} from '../lib/tokens.js';
import {
  applyColorScheme,
  readColorSchemePreference,
} from '../lib/color-scheme.js';
import './timeline-view.js';

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
import type {UpdatesView} from './updates-view.js';
import {onDeepLink, writeHashLink} from './deep-link.js';
import type {DeepLinkTab} from './deep-link.js';
import './devtools-settings.js';
import '../lib/segmented-tabs.js';
import type {TabItem} from '../lib/segmented-tabs.js';
import {CUBE_ICON, CLOCK_ICON, FLAME_ICON, GEAR_ICON} from '../lib/icons.js';

/**
 * Tabs hosted by the panel. The Timeline is the first; this list is the
 * extension point for future Lit DevTools views.
 */
const TABS: readonly TabItem[] = [
  {id: 'components', label: 'Components', icon: CUBE_ICON},
  {id: 'updates', label: 'Updates', icon: FLAME_ICON},
  {id: 'timeline', label: 'Timeline', icon: CLOCK_ICON},
  {id: 'settings', label: 'Settings', icon: GEAR_ICON},
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
      .brand svg {
        display: block;
      }
      .view {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
    `,
  ];

  @state() private _tab = 'components';

  /** Mirrors `ComponentsView.hmrIncompatibilityCount`; see `_onHmrCountChange`. */
  @state() private _hmrCount = 0;

  @query('components-view') private _componentsView?: ComponentsView;
  @query('updates-view') private _updatesView?: UpdatesView;

  /**
   * Tab items for the strip, badging "Components" with the current
   * HMR-incompatibility count when there is one.
   */
  private get _tabs(): readonly TabItem[] {
    if (this._hmrCount === 0) return TABS;
    return TABS.map((t) =>
      t.id === 'components' ? {...t, badge: this._hmrCount} : t
    );
  }

  private _onTabChange(e: CustomEvent<{value: string}>) {
    this._tab = e.detail.value;
    this._syncHash();
  }

  /**
   * Deep links are wired after the first render, not in `connectedCallback`:
   * the `@query` for the Components view resolves against rendered DOM, and a
   * link naming a component would silently drop its selection if applied
   * before there is a view to hand it to.
   */
  override firstUpdated() {
    // Two sources, one shape: the URL hash the panel opened with (standalone,
    // or a snapshot someone was sent) and the hub activating our dock with
    // params (another devframe, a command, or this plugin's own overlay pick).
    onDeepLink((link) => {
      if (link.tab !== undefined) this._tab = link.tab;
      if (link.componentId === undefined) {
        this._syncHash();
        return;
      }
      // An element id means the same thing in both views, so honour the tab
      // the link asked for and only default to Components when it named none
      // — otherwise `#tab=updates&component=3` would land on the wrong tab and
      // look like the parameter was ignored.
      if (link.tab !== 'updates') this._tab = 'components';
      const componentId = link.componentId;
      // The Updates view is mounted lazily, so a link naming it has no view to
      // hand the id to until the tab switch has actually rendered.
      void this.updateComplete.then(() => {
        if (this._tab === 'updates') {
          this._updatesView?.selectById(componentId);
        } else {
          this._componentsView?.selectById(componentId);
        }
        this._syncHash();
      });
    });
  }

  /**
   * Keep the address bar pointing at what is on screen, so copying it is a
   * link. Only meaningful when the panel owns its URL — docked in the hub it
   * is an iframe nobody reads the address of, and writing there would be
   * noise.
   */
  private _syncHash(): void {
    if (window.top !== window.self) return;
    // Whichever view owns a selection on the tab in front; both express it as
    // a stable element id, so one parameter round-trips for either.
    const selectedId =
      this._tab === 'updates'
        ? this._updatesView?.selectedId
        : this._componentsView?.selectedId;
    writeHashLink({
      tab: this._tab as DeepLinkTab,
      ...(selectedId === null || selectedId === undefined
        ? {}
        : {componentId: selectedId}),
    });
  }

  /**
   * A component couldn't be hot-patched in place. Passive badge only — unlike
   * `_onInspectorActivate`, this must not switch tabs: an incompatibility is
   * not something the developer asked to look at.
   */
  private _onHmrCountChange(e: CustomEvent<{count: number}>) {
    this._hmrCount = e.detail.count;
  }

  /** A timeline event's "inspect" link — open the Components tab on it. */
  private _onInspectElement(e: CustomEvent<{id: number}>) {
    this._tab = 'components';
    // The view is always mounted, so it can select without waiting for render.
    this._componentsView?.selectById(e.detail.id);
    this._syncHash();
  }

  /**
   * A component was picked via the overlay inspector — switch to the
   * Components tab so the picked element is what the panel shows.
   *
   * Bringing the dock itself to the front is the host's job, not ours: the
   * node side calls `docks.activate()` when it forwards the pick (see
   * lib/devframe/vite.ts). That replaced reaching into the parent frame's
   * `__VITE_DEVTOOLS_CLIENT_CONTEXT__`, which only worked inside Vite
   * DevTools and only while the panel was same-origin with the shell.
   */
  private _onInspectorActivate() {
    this._tab = 'components';
    this._syncHash();
  }

  override render() {
    return html`
      <header>
        <span class="brand">${LIT_LOGO_SVG} Lit DevTools</span>
        <segmented-tabs
          .items=${this._tabs}
          .value=${this._tab}
          @change=${this._onTabChange}
        ></segmented-tabs>
      </header>
      <div class="view" @inspect-element=${this._onInspectElement}>
        <timeline-view ?hidden=${this._tab !== 'timeline'}></timeline-view>
        <!-- Kept mounted (like the timeline) so an overlay inspect-pick can
             arrive and switch us here even while another tab is in front. -->
        <components-view
          ?hidden=${this._tab !== 'components'}
          @inspector-activate=${this._onInspectorActivate}
          @selection-change=${this._syncHash}
          @hmr-count-change=${this._onHmrCountChange}
        ></components-view>
        <!-- Mounted lazily: the recording it derives from lives in the
             timeline store and keeps filling whether or not this view exists,
             so there is nothing here to keep alive in the background. -->
        ${
          this._tab === 'updates'
            ? html`<updates-view
                @selection-change=${this._syncHash}
              ></updates-view>`
            : nothing
        }
        ${
          this._tab === 'settings'
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
