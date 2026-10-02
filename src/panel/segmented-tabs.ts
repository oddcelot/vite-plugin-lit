import {LitElement, html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import type {WaTabShowEvent} from '@awesome.me/webawesome/dist/events/tab-show.js';
import {tokens} from '../lib/tokens.js';
import type {IconName} from './wa-icons.js';

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Optional count pill trailing the label. Hidden when absent or zero. */
  badge?: number;
}

export type SegTabSize = 'sm' | 'md';

/**
 * A row of tabs over a Web Awesome `wa-tab-group`, with the panels left out:
 * callers keep their views mounted and toggle them themselves (the Timeline
 * has to keep recording while another tab is in front), so this only picks.
 *
 * Fires `change` with `detail.value` when the user picks a tab; setting
 * `value` from outside moves the selection without firing it.
 */
@customElement('segmented-tabs')
export class SegmentedTabs extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        align-self: stretch;
      }
      wa-tab-group {
        --indicator-color: var(--wa-color-brand-fill-loud);
        --track-color: transparent;
        --track-width: 2px;
        height: 100%;
      }
      wa-tab-group::part(base),
      wa-tab-group::part(tabs) {
        height: 100%;
      }
      /* Lets the unnamed .nav wrapper inside stretch to the full height, so
         the indicator sits on the header's bottom edge. */
      wa-tab-group::part(nav) {
        display: flex;
        height: 100%;
      }
      wa-tab {
        height: 100%;
      }
      wa-tab-group::part(body) {
        display: none;
      }
      wa-tab::part(base) {
        height: 100%;
        gap: var(--wa-space-2xs);
        padding-block: 0;
        padding-inline: var(--wa-space-s);
        font-size: var(--wa-font-size-m);
        white-space: nowrap;
      }
      :host([size='sm']) wa-tab::part(base) {
        padding-inline: var(--wa-space-xs);
        font-size: var(--wa-font-size-s);
      }
      wa-icon {
        font-size: 1.15em;
      }
    `,
  ];

  @property({type: Array}) declare items: TabItem[];

  @property() declare value: string;

  @property({reflect: true}) declare size: SegTabSize;

  constructor() {
    super();
    this.items = [];
    this.value = '';
    this.size = 'md';
  }

  private _onTabShow(e: WaTabShowEvent): void {
    // The group also announces selections made through `value`; only a pick
    // that differs from it is the user's.
    e.stopPropagation();
    const id = e.detail.name;
    if (id === this.value) return;
    this.value = id;
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: {value: id},
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    return html`
      <wa-tab-group .active=${this.value} @wa-tab-show=${this._onTabShow}>
        ${this.items.map(
          (item) => html`
            <wa-tab slot="nav" panel=${item.id}>
              ${
                item.icon
                  ? html`<wa-icon name=${item.icon}></wa-icon>`
                  : nothing
              }
              ${item.label}
              ${
                item.badge
                  ? html`<wa-badge variant="danger" pill
                      >${item.badge}</wa-badge
                    >`
                  : nothing
              }
            </wa-tab>
          `
        )}
      </wa-tab-group>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'segmented-tabs': SegmentedTabs;
  }
}
