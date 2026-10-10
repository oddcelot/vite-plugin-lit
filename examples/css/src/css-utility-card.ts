import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import tokens from './tokens.css?css-sheet';
import card from './card.css?css-sheet';
import uno from './uno.generated.css?css-sheet';

/**
 * UnoCSS utilities, delivered as one shared sheet. `uno.generated.css` is
 * written by `uno-sheet.ts`; importing it with `?css-sheet` gives every
 * component that does the same `CSSStyleSheet` object.
 *
 * Try: add a text-transform utility to the button's class list (the README
 * says which). The sheet is regenerated and swapped in place for every
 * adopter. This card re-renders as well, but only because its own template
 * changed: the page and the other cards that adopt the sheet keep their
 * badges.
 */
@customElement('css-utility-card')
export class CssUtilityCard extends LitElement {
  static override styles = [tokens, card, uno];

  private renders = 0;

  override render() {
    return html`
      <h2>UnoCSS utilities</h2>
      <p class="shape">
        <code>?css-sheet</code>, one shared sheet. A new class swaps the sheet
        in place; this card re-renders only because its template changed.
      </p>
      <button
        class="bg-brand text-white font-semibold px-4 py-2 border-none cursor-pointer"
      >
        Utility button
      </button>
      <br />
      <span class="badge">renders: 0</span>
    `;
  }

  override updated() {
    this.renders++;
    const badge = this.renderRoot.querySelector('.badge');
    if (badge !== null) {
      badge.textContent = `renders: ${this.renders}`;
    }
  }
}
