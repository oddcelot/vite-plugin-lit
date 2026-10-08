import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

/**
 * Changes a reactive property inside `updated`, which Lit's dev build warns
 * about (`change-in-update`). The change is guarded to happen once per
 * click, so it schedules one extra update and never loops.
 */
@customElement('hmr-warnings')
export class HmrWarnings extends LitElement {
  static override styles = css`
    .note {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
    button:focus {
      outline: 2px solid dodgerblue;
    }
  `;

  @state()
  private clicks = 0;

  @state()
  private echoed = 0;

  override render() {
    return html`
      <h2>Lit warnings</h2>
      <button id="trigger" @click=${() => this.clicks++}>
        clicks: ${this.clicks}, echoed: ${this.echoed}
      </button>
      <p class="note">
        Intentionally changes state in updated(): triggers Lit's
        change-in-update dev warning.
      </p>
    `;
  }

  override updated() {
    // Guarded: only echo when behind, so this runs once per click.
    if (this.echoed !== this.clicks) {
      this.echoed = this.clicks;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hmr-warnings': HmrWarnings;
  }
}
