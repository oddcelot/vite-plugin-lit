import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import tokens from './tokens.css?css-sheet';
import card from './card.css?css-sheet';

/**
 * A plain `css` literal in `static styles`. The plugin runs it through
 * Lightning CSS with the targets in `vite.config.ts`, as it would a `.css`
 * file, so the nesting, `oklch()` and `light-dark()` below are downlevelled
 * for those browsers. Only a literal with no `${}` holes is handled.
 *
 * Try: `npm run build`, then find `.sample` in `dist/assets/*.js`. The
 * nesting is flattened and each colour has a fallback.
 */
@customElement('css-literal-card')
export class CssLiteralCard extends LitElement {
  static override styles = [
    tokens,
    card,
    css`
      .sample {
        padding: var(--space);
        border-radius: var(--radius);
        color-scheme: light dark;
        background: light-dark(oklch(0.96 0.04 85), oklch(0.3 0.05 85));
        color: light-dark(oklch(0.3 0.08 85), oklch(0.95 0.04 85));

        & em {
          color: oklch(0.55 0.22 25);
          font-style: normal;
          font-weight: 600;
        }
      }
    `,
  ];

  private renders = 0;

  override render() {
    return html`
      <h2>CSS literal</h2>
      <p class="shape">
        <code>css\`\`</code> in <code>static styles</code>, run through
        Lightning CSS. An edit re-renders this card.
      </p>
      <div class="sample">Nested, <em>oklch</em>, light or dark</div>
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
