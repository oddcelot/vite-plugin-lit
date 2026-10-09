import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

@customElement('fh-toast')
export class FhToast extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      left: 50%;
      bottom: 72px;
      z-index: 10;
      transform: translateX(-50%);
      pointer-events: none;
    }
    div {
      padding: 12px 20px;
      border-radius: 10px;
      background: #1f2a1f;
      color: #eaf3ec;
      font-weight: 600;
      font-size: 15px;
      box-shadow: 0 10px 30px rgba(31, 42, 31, 0.25);
      opacity: 0;
      transform: translateY(8px);
      transition:
        opacity 0.2s,
        transform 0.2s;
    }
    div.visible {
      opacity: 1;
      transform: none;
    }
  `;

  @state() private message = '';
  @state() private visible = false;
  #timer?: number;

  /** Show a message for a moment. Called by <fh-app> after an add-to-cart. */
  show(message: string) {
    this.message = message;
    this.visible = true;
    clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => (this.visible = false), 2200);
  }

  render() {
    return html`<div class=${this.visible ? 'visible' : ''} role="status">
      ${this.message}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fh-toast': FhToast;
  }
}
