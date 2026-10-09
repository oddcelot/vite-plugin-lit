import {LitElement, css, html} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {provide} from '@lit/context';
import {cartContext, type Cart, type CartItem} from './cart-context';
import {products} from './products';
import {plantArt} from './plant-art';
import './fh-header';
import './fh-product-card';
import './fh-reviews';
import './fh-toast';
import type {FhToast} from './fh-toast';

@customElement('fh-app')
export class FhApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      font-family:
        Manrope,
        ui-sans-serif,
        system-ui,
        -apple-system,
        'Segoe UI',
        Roboto,
        sans-serif;
      color: #1f2a1f;
      background: #f4f1ea;
    }
    main {
      max-width: 1276px;
      box-sizing: border-box;
      margin: 0 auto;
      padding: 28px 32px 96px;
    }
    .banner {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 24px;
      border-radius: 10px;
      background: #2f6f4e;
      color: #eaf3ec;
      font-weight: 600;
      font-size: 17px;
    }
    .banner a {
      margin-left: auto;
      padding: 8px 18px;
      border-radius: 18px;
      background: #eaf3ec;
      color: #2f6f4e;
      font-weight: 700;
      font-size: 15px;
      text-decoration: none;
      white-space: nowrap;
    }
    h2 {
      margin: 32px 0 4px;
      font-weight: 800;
      font-size: 22px;
      letter-spacing: -0.02em;
    }
    .lede {
      margin: 0 0 20px;
      font-weight: 500;
      color: #6b7466;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
    }
    .empty {
      grid-column: 1 / -1;
      padding: 48px 0;
      text-align: center;
      color: #6b7466;
    }
    .was {
      margin-left: 6px;
      color: #8b927f;
      text-decoration: line-through;
    }

    /* The card's parts, styled from out here. Without these the cards keep
       the look they ship with. */
    fh-product-card::part(title) {
      font-size: 19px;
    }
    fh-product-card::part(cta) {
      border-radius: 18px;
    }
  `;

  // The cart, provided to every component below. <fh-cart-button> reads it
  // without anything being passed down through <fh-header>.
  @provide({context: cartContext})
  @state()
  private cart: Cart = {items: []};

  @state() private query = '';
  @query('fh-toast') private toast!: FhToast;

  render() {
    const q = this.query.trim().toLowerCase();
    const shown = products.filter((p) => p.name.toLowerCase().includes(q));
    return html`
      <fh-header
        @search-changed=${(e: CustomEvent<string>) => (this.query = e.detail)}
      ></fh-header>
      <main @add-to-cart=${this.#onAdd}>
        <div class="banner">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <path
              d="M3 9H17V20H3Z"
              stroke="#eaf3ec"
              stroke-width="1.8"
              fill="none"
              stroke-linejoin="round"
            />
            <path
              d="M17 12H22L25 16V20H17"
              stroke="#eaf3ec"
              stroke-width="1.8"
              fill="none"
              stroke-linejoin="round"
            />
            <circle
              cx="8"
              cy="21"
              r="2.2"
              fill="#2f6f4e"
              stroke="#eaf3ec"
              stroke-width="1.8"
            />
            <circle
              cx="20.5"
              cy="21"
              r="2.2"
              fill="#2f6f4e"
              stroke="#eaf3ec"
              stroke-width="1.8"
            />
          </svg>
          Free delivery on orders over €60, with a plant-care card in every box.
          <a href="#">See delivery</a>
        </div>
        <h2>New this week</h2>
        <p class="lede">Fresh from the greenhouse, ready to repot.</p>
        <div class="grid">
          ${shown.map(
            (p) => html`
              <fh-product-card
                .productId=${p.id}
                .name=${p.name}
                .price=${p.price}
                .badge=${p.badge ?? ''}
              >
                ${plantArt(p.art)}
                ${
                  p.was
                    ? html`<span slot="price"
                        >€${p.price}<span class="was">€${p.was}</span></span
                      >`
                    : ''
                }
                ${p.note}
                ${
                  p.id === 'fiddle'
                    ? html`<fh-reviews product-id=${p.id}></fh-reviews>`
                    : ''
                }
              </fh-product-card>
            `
          )}
          ${
            shown.length
              ? ''
              : html`<p class="empty">No plants match “${this.query}”.</p>`
          }
        </div>
      </main>
      <fh-toast></fh-toast>
    `;
  }

  #onAdd(e: CustomEvent<CartItem>) {
    // A new object each time: that is what tells the consumers to update.
    this.cart = {items: [...this.cart.items, e.detail]};
    this.toast.show(`Added ${e.detail.name} to your cart`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fh-app': FhApp;
  }
}
