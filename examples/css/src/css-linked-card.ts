import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import tokens from './tokens.css?css-sheet';
import card from './card.css?css-sheet';
import cssHref from './css-linked-card.css?hmr-url';

/**
 * Rules this card owns, in a real `.css` file. `?hmr-url` is the file's URL:
 * served as is in dev, a content-hashed asset in a build.
 *
 * Try: change `padding` in `css-linked-card.css`. The card re-renders with a
 * new, cache-busted href, so the browser refetches. The badge counts it.
 */
@customElement('css-linked-card')
export class CssLinkedCard extends LitElement {
  static override styles = [tokens, card];

  private renders = 0;

  override render() {
    return html`
      <link rel="stylesheet" href=${cssHref} />
      <h2>Linked file</h2>
      <p class="shape">
        <code>?hmr-url</code> in a <code>&lt;link&gt;</code>. An edit re-renders
        this card with a fresh href.
      </p>
      <div class="sample"><strong>Fetched</strong> from its own .css file</div>
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
