import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import './fh-search';
import './fh-cart-button';

@customElement('fh-header')
export class FhHeader extends LitElement {
  static styles = css`
    :host {
      display: block;
      background: #fff;
      border-bottom: 1px solid #e3ddd0;
    }
    header {
      display: flex;
      align-items: center;
      gap: 26px;
      max-width: 1276px;
      box-sizing: border-box;
      margin: 0 auto;
      padding: 8px 32px;
      font-weight: 600;
      font-size: 15px;
      color: #4a564a;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 800;
      font-size: 24px;
      letter-spacing: -0.02em;
      color: #2f6f4e;
    }
    nav {
      display: flex;
      gap: 22px;
    }
    nav a {
      color: inherit;
      text-decoration: none;
    }
    nav a:hover {
      color: #2f6f4e;
    }
    fh-search {
      flex: 1;
      max-width: 400px;
    }
    .more {
      margin-left: auto;
    }
    @media (max-width: 1000px) {
      .more {
        display: none;
      }
      fh-search {
        max-width: none;
      }
      fh-cart-button {
        margin-left: auto;
      }
    }
    @media (max-width: 680px) {
      nav {
        display: none;
      }
    }
  `;

  render() {
    return html`
      <header>
        <span class="logo">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <path d="M4 22C4 11 11 4 23 3.5C23 15 16 22 4 22Z" fill="#2f6f4e" />
            <path
              d="M4 22L15 11"
              stroke="#cfe8d6"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path
              d="M10 16L10 12.5M12.6 13.4L16.2 13.4"
              stroke="#cfe8d6"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
          Fernhouse
        </span>
        <nav><a href="#">Shop</a><a href="#">Care</a></nav>
        <fh-search></fh-search>
        <nav class="more">
          <a href="#">Journal</a><a href="#">Gifts</a><a href="#">Workshops</a
          ><a href="#">Account</a>
        </nav>
        <fh-cart-button></fh-cart-button>
      </header>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fh-header': FhHeader;
  }
}
