import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {cartContext, type Cart} from './cart-context';

@customElement('fh-cart-button')
export class FhCartButton extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    button {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 18px;
      border: 0;
      border-radius: 18px;
      background: #2f6f4e;
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: #285f43;
    }
  `;

  // Not passed down as an attribute: the cart comes from the nearest
  // <fh-app> above, however many shadow roots away. When it changes, only
  // this button re-renders. The panel's Components tab shows the link.
  @consume({context: cartContext, subscribe: true})
  private cart?: Cart;

  render() {
    return html`
      <button type="button">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M2 3H4L5.6 11.5H14L15.5 5.5H5"
            stroke="#fff"
            stroke-width="1.6"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="6.8" cy="14.6" r="1.3" fill="#fff" />
          <circle cx="12.8" cy="14.6" r="1.3" fill="#fff" />
        </svg>
        Cart · ${this.cart?.items.length ?? 0}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fh-cart-button': FhCartButton;
  }
}
