import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

@customElement('fh-search')
export class FhSearch extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    label {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 36px;
      padding: 0 14px;
      border-radius: 18px;
      background: #f4f1ea;
      border: 1px solid #e8e2d4;
      color: #8b927f;
    }
    label:focus-within {
      border-color: #2f6f4e;
      box-shadow: 0 0 0 3px rgba(47, 111, 78, 0.15);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      font: inherit;
      font-weight: 500;
      color: #1f2a1f;
    }
    input::placeholder {
      color: #8b927f;
    }
  `;

  /** What has been typed. The panel shows it under State. */
  @state() private query = '';

  render() {
    return html`
      <label>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle
            cx="7"
            cy="7"
            r="4.6"
            stroke="currentColor"
            stroke-width="1.6"
            fill="none"
          />
          <path
            d="M10.4 10.4L14 14"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        <input
          type="search"
          placeholder="Search plants"
          aria-label="Search plants"
          .value=${this.query}
          @input=${this.#onInput}
        />
      </label>
    `;
  }

  #onInput(e: Event) {
    this.query = (e.target as HTMLInputElement).value;
    // Bubbles and is composed, so <fh-app> hears it through <fh-header>'s
    // shadow root. The Timeline lists each keystroke and this event with it.
    this.dispatchEvent(
      new CustomEvent('search-changed', {
        detail: this.query,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fh-search': FhSearch;
  }
}
