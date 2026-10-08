import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

/**
 * Renders `<hmr-not-defined>`, a tag nothing defines until the button is
 * clicked. In the DevTools tree it carries the "not defined" marker, which
 * disappears once the tag is defined.
 */
@customElement('hmr-undefined')
export class HmrUndefined extends LitElement {
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
  private defined = customElements.get('hmr-not-defined') !== undefined;

  private define() {
    if (customElements.get('hmr-not-defined') === undefined) {
      customElements.define(
        'hmr-not-defined',
        class extends HTMLElement {
          connectedCallback() {
            this.textContent = 'now defined';
          }
        }
      );
    }
    this.defined = true;
  }

  override render() {
    return html`
      <h2>Undefined elements</h2>
      <hmr-not-defined>intentionally undefined</hmr-not-defined>
      <p class="note">
        <code>&lt;hmr-not-defined&gt;</code> is intentionally never defined.
      </p>
      <button id="define" ?disabled=${this.defined} @click=${this.define}>
        Define it
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hmr-undefined': HmrUndefined;
  }
}
