import {LitElement, html, unsafeCSS} from 'lit';
import {customElement} from 'lit/decorators.js';
import tokens from './tokens.css?css-sheet';
import card from './card.css?css-sheet';
import inlineCss from './css-inline-card.css?inline';

/**
 * Rules this card owns, shipped in the JS chunk. `?inline` gives the file's
 * text after Vite's CSS pipeline, so Lightning CSS has run over it; `?raw`
 * would give the text as written and skip the pipeline. `unsafeCSS` turns
 * either into something `static styles` accepts.
 *
 * Try: change `border` in `css-inline-card.css`. The module re-runs, the
 * plugin swaps this class's styles on the live card, and the badge moves.
 */
@customElement('css-inline-card')
export class CssInlineCard extends LitElement {
  static override styles = [tokens, card, unsafeCSS(inlineCss)];

  private renders = 0;

  override render() {
    return html`
      <h2>Inlined file</h2>
      <p class="shape">
        <code>?inline</code> with <code>unsafeCSS</code>. No fetch, no flash; an
        edit re-renders this card. (<code>?raw</code> skips the pipeline.)
      </p>
      <div class="sample">Inlined from its own .css file</div>
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
