import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import tokens from './tokens.css?css-sheet';
import uno from './uno.generated.css?css-sheet';
import './css-utility-card';
import './css-linked-card';
import './css-inline-card';
import './css-literal-card';

/**
 * The page: a heading and the four cards. Its layout is UnoCSS utilities from
 * the same shared sheet the utility card adopts.
 */
@customElement('css-tour')
export class CssTour extends LitElement {
  static override styles = [tokens, uno];

  override render() {
    return html`
      <main class="max-w-4xl mx-auto p-6 font-sans">
        <h1 class="text-3xl font-bold text-brand m-0">CSS tour</h1>
        <p class="text-slate-600 leading-relaxed max-w-2xl">
          One card per way of delivering CSS. Each counts its renders. Edit a
          file named on a card and watch which badges move.
        </p>
        <div class="grid gap-4 md:grid-cols-2">
          <css-utility-card></css-utility-card>
          <css-linked-card></css-linked-card>
          <css-inline-card></css-inline-card>
          <css-literal-card></css-literal-card>
        </div>
      </main>
    `;
  }
}
