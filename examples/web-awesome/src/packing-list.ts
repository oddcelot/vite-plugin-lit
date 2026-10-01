import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import type WaCheckbox from '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type WaSwitch from '@awesome.me/webawesome/dist/components/switch/switch.js';

interface Item {
  id: number;
  label: string;
  packed: boolean;
}

/**
 * A packing list drawn with Web Awesome elements. Keep the page open and edit
 * this file: each save patches `<packing-list>` in place. The `<wa-*>`
 * elements inside it are not touched, so whatever they hold (the text in the
 * input, the switch, the ticks) is still there afterwards.
 *
 * - `items` and `hidePacked` are reactive state (`@state`).
 * - `#nextId` is a native private field, kept across patches too.
 * - The progress bar's colour is a custom property in `styles`.
 */
@customElement('packing-list')
export class PackingList extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: min(26rem, 100vw - 2rem);
    }

    wa-card {
      /* Web Awesome reads its design tokens through custom properties, so a
         change here restyles its elements without a reload. Try
         var(--wa-color-success-fill-loud). */
      --packed-color: var(--wa-color-brand-fill-loud);
    }
    wa-progress-bar {
      --indicator-color: var(--packed-color);
      --track-height: 0.5rem;
    }

    [slot='header'] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--wa-space-s);
    }
    h2 {
      margin: 0;
      font-size: var(--wa-font-size-l);
    }

    form {
      display: flex;
      gap: var(--wa-space-xs);
      margin-block: var(--wa-space-m);
    }
    form wa-input {
      flex: 1;
    }

    ul {
      display: grid;
      gap: var(--wa-space-xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .empty {
      color: var(--wa-color-text-quiet);
    }
  `;

  @state() private items: Item[] = [
    {id: 1, label: 'Passport', packed: true},
    {id: 2, label: 'Charger', packed: false},
    {id: 3, label: 'Toothbrush', packed: false},
  ];

  /** Whether packed items are left out of the list. */
  @state() private hidePacked = false;

  /** The id the next item gets. Lit does not watch native private fields. */
  #nextId = 4;

  #add(e: SubmitEvent) {
    e.preventDefault();
    const input = this.renderRoot.querySelector<WaInput>('wa-input')!;
    const label = (input.value ?? '').trim();
    if (!label) return;
    this.items = [...this.items, {id: this.#nextId++, label, packed: false}];
    input.value = '';
  }

  #toggle(item: Item, packed: boolean) {
    this.items = this.items.map((i) => (i === item ? {...i, packed} : i));
  }

  override render() {
    const packed = this.items.filter((i) => i.packed).length;
    const total = this.items.length;
    const shown = this.hidePacked
      ? this.items.filter((i) => !i.packed)
      : this.items;
    return html`
      <wa-card>
        <div slot="header">
          <h2>Packing list</h2>
          <wa-badge variant=${packed === total ? 'success' : 'neutral'} pill>
            ${packed} / ${total}
          </wa-badge>
        </div>

        <wa-progress-bar
          label="Packed"
          value=${total ? (packed / total) * 100 : 0}
        ></wa-progress-bar>

        <form @submit=${this.#add}>
          <wa-input
            placeholder="Add something to pack"
            aria-label="Item"
          ></wa-input>
          <wa-button type="submit" variant="brand">Add</wa-button>
        </form>

        <ul>
          ${shown.map(
            (item) => html`
              <li>
                <wa-checkbox
                  .checked=${item.packed}
                  @change=${(e: Event) =>
                    this.#toggle(item, (e.target as WaCheckbox).checked)}
                >
                  ${item.label}
                </wa-checkbox>
              </li>
            `
          )}
          ${
            shown.length
              ? null
              : html`<li class="empty">Everything is packed.</li>`
          }
        </ul>

        <wa-switch
          slot="footer"
          .checked=${this.hidePacked}
          @change=${(e: Event) =>
            (this.hidePacked = (e.target as WaSwitch).checked)}
        >
          Hide packed items
        </wa-switch>
      </wa-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'packing-list': PackingList;
  }
}
