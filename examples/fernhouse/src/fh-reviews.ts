import {LitElement, css, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {Task} from '@lit/task';
import {fetchReviews} from './products';

@customElement('fh-reviews')
export class FhReviews extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-size: 14px;
      color: #6b7466;
    }
    .rating {
      font-weight: 700;
      color: #1f2a1f;
    }
    .rating b {
      color: #c98a16;
    }
    q {
      display: block;
      margin-top: 4px;
      font-style: italic;
    }
    button {
      margin-left: 6px;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      font-weight: 600;
      color: #2f6f4e;
      cursor: pointer;
      text-decoration: underline;
    }
    .pending {
      color: #8b927f;
    }
  `;

  @property({attribute: 'product-id'}) productId = '';
  @state() private page = 0;

  // Runs again whenever `productId` or `page` changes. The panel lists each
  // run on the Timeline, and the pending phase shows as its own update.
  #reviews = new Task(this, {
    task: ([productId, page], {signal}) =>
      fetchReviews(productId, page, signal),
    args: () => [this.productId, this.page] as const,
  });

  render() {
    return this.#reviews.render({
      pending: () => html`<span class="pending">Loading reviews…</span>`,
      complete: ({rating, count, quote, author}) => html`
        <span class="rating"><b>★</b> ${rating} · ${count} reviews</span>
        <button type="button" @click=${() => this.page++}>More reviews</button>
        <q>${quote}</q> – ${author}
      `,
      error: () => html`<span class="pending">Reviews are unavailable.</span>`,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'fh-reviews': FhReviews;
  }
}
