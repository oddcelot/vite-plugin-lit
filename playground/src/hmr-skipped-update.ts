import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

/**
 * `shouldUpdate` vetoes odd counts: the property changes and an update is
 * requested, but the render is skipped, which the DevTools flags as a
 * skipped update. The shown count only catches up on even values.
 */
@customElement('hmr-skipped-update')
export class HmrSkippedUpdate extends LitElement {
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
  private count = 0;

  protected override shouldUpdate() {
    return this.count % 2 === 0;
  }

  override render() {
    return html`
      <h2>Skipped updates</h2>
      <button id="increment" @click=${() => this.count++}>
        count: ${this.count}
      </button>
      <p class="note">Odd counts are skipped: shouldUpdate returns false.</p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hmr-skipped-update': HmrSkippedUpdate;
  }
}
