/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {tokens, injectTokens} from '../lib/tokens.js';
import {
  applyTheme,
  readThemePreference,
  startThemeAutoSync,
} from '../lib/theme.js';
import './timeline-view.js';

// Install the shared design tokens on the panel iframe's :root before the
// views render. Panel components inherit the semantic aliases from :root.
injectTokens();
// Own the theme class once the panel module is live: re-assert the saved
// preference (the Settings tab mounts lazily, so it can't), and follow the OS
// color scheme live while in `auto`.
applyTheme(readThemePreference());
startThemeAutoSync();
import './components-view.js';
import type {ComponentsView} from './components-view.js';
import './devtools-settings.js';
import '../lib/segmented-tabs.js';
import type {TabItem} from '../lib/segmented-tabs.js';
import {CUBE_ICON, CLOCK_ICON, GEAR_ICON} from '../lib/icons.js';

/**
 * Tabs hosted by the panel. The Timeline is the first; this list is the
 * extension point for future Lit DevTools views.
 */
const TABS: readonly TabItem[] = [
  {id: 'components', label: 'Components', icon: CUBE_ICON},
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
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        background: var(--bg);
        color: var(--text);
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--space-6);
        padding: 0 var(--space-5);
        border-bottom: 1px solid var(--border);
        background: var(--surface-low);
        flex-shrink: 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        color: var(--text-strong);
        font-weight: var(--weight-bold);
        font-size: var(--text-xs);
        letter-spacing: var(--tracking-caps);
        text-transform: uppercase;
        padding: var(--space-5) 0;
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

  @query('components-view') private _componentsView?: ComponentsView;

  private _onTabChange(e: CustomEvent<{value: string}>) {
    this._tab = e.detail.value;
  }

  /** A timeline event's "inspect" link — open the Components tab on it. */
  private _onInspectElement(e: CustomEvent<{id: number}>) {
    this._tab = 'components';
    // The view is always mounted, so it can select without waiting for render.
    this._componentsView?.selectById(e.detail.id);
  }

  override render() {
    return html`
      <header>
        <span class="brand">${LIT_LOGO_SVG} Lit DevTools</span>
        <segmented-tabs
          .items=${TABS}
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
          @inspector-activate=${() => (this._tab = 'components')}
        ></components-view>
        ${this._tab === 'settings'
          ? html`<devtools-settings></devtools-settings>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lit-devtools-panel': LitDevtoolsPanel;
  }
}
