import {LitElement, css, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

@customElement('fh-product-card')
export class FhProductCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    article {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      overflow: hidden;
      background: #fff;
      border: 1px solid #e3ddd0;
      border-radius: 10px;
      box-shadow:
        0 1px 2px rgba(31, 42, 31, 0.04),
        0 6px 18px rgba(31, 42, 31, 0.05);
    }
    .media {
      height: 150px;
      background: #e3eddc;
    }
    ::slotted([slot='media']) {
      display: block;
      width: 100%;
      height: 100%;
    }
    .badge {
      position: absolute;
      top: 12px;
      left: 12px;
      padding: 3px 9px;
      border-radius: 11px;
      background: rgba(255, 255, 255, 0.88);
      font-weight: 700;
      font-size: 12px;
      color: #2f6f4e;
    }
    .body {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
      padding: 14px 16px 16px;
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }
    h3 {
      margin: 0;
      font-weight: 700;
      font-size: 18px;
      letter-spacing: -0.01em;
      color: #1f2a1f;
    }
    .price {
      font-family: ui-monospace, 'Roboto Mono', Menlo, monospace;
      font-size: 16px;
      color: #1f2a1f;
      white-space: nowrap;
    }
    .desc {
      flex: 1;
      font-size: 14px;
      color: #6b7466;
    }
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
    }
    button.cta {
      height: 36px;
      padding: 0 18px;
      border: 1.5px solid #2f6f4e;
      border-radius: 6px;
      background: transparent;
      color: #2f6f4e;
      font: inherit;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
    }
    button.cta:hover {
      background: #eef5f0;
    }
    button.cta.in-cart {
      background: #2f6f4e;
      color: #fff;
    }
    button.heart {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: #8b927f;
      cursor: pointer;
    }
    button.heart:hover {
      color: #c2453d;
    }
  `;

  @property() productId = '';
  @property() name = '';
  @property({type: Number}) price = 0;
  @property() badge = '';
  /** True once something from this card is in the cart. */
  @state() private inCart = false;

  // The panel's Anatomy view draws this card's slots (media, the default
  // slot, price) and its parts (title, cta), and shows what fills each one.
  render() {
    return html`
      <article>
        <div class="media"><slot name="media"></slot></div>
        ${this.badge ? html`<span class="badge">${this.badge}</span>` : ''}
        <div class="body">
          <div class="head">
            <h3 part="title">${this.name}</h3>
            <!-- Fallback content: shown unless the page fills the slot,
                 e.g. with a sale price. -->
            <span class="price">
              <slot name="price">€${this.price}</slot>
            </span>
          </div>
          <div class="desc"><slot></slot></div>
          <footer>
            <button
              class="cta ${this.inCart ? 'in-cart' : ''}"
              part="cta"
              type="button"
              @click=${this.#add}
            >
              ${this.inCart ? 'Added · add another' : 'Add to cart'}
            </button>
            <button class="heart" type="button" aria-label="Save ${this.name}">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  d="M10 16.5C4 12.5 2.5 9.8 2.5 7.4C2.5 5.2 4.2 3.5 6.3 3.5C7.8 3.5 9.2 4.4 10 5.7C10.8 4.4 12.2 3.5 13.7 3.5C15.8 3.5 17.5 5.2 17.5 7.4C17.5 9.8 16 12.5 10 16.5Z"
                  stroke="currentColor"
                  stroke-width="1.5"
                  fill="none"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </footer>
        </div>
      </article>
    `;
  }

  #add() {
    this.inCart = true;
    // The click, this card's update and the event all land on the Timeline,
    // with the cart button's update linked back to the click that caused it.
    this.dispatchEvent(
      new CustomEvent('add-to-cart', {
        detail: {id: this.productId, name: this.name, price: this.price},
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fh-product-card': FhProductCard;
  }
}
