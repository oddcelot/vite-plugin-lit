import {LitElement, css, html} from 'lit';
import {customElement} from 'lit/decorators.js';

/**
 * Slot and `::part` surface for the Components tab's anatomy view: a named
 * slot, the default slot, a slot showing fallback content, an empty slot,
 * two parts, and (from the page) a child asking for a slot that does not
 * exist. `<hmr-slots-frame>` forwards its own default slot into the card,
 * so the card's default slot receives forwarded content.
 */
@customElement('hmr-slots')
export class HmrSlots extends LitElement {
  static override styles = css`
    :host {
      display: block;
      border: 1px solid var(--card-border, #ccc);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
    }
    header,
    footer {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    footer {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  override render() {
    return html`
      <header part="header">
        <slot name="icon"></slot>
        <slot name="title"></slot>
      </header>
      <div part="body">
        <slot></slot>
      </div>
      <footer>
        <slot name="footer">No footer given, so this is fallback content.</slot>
      </footer>
    `;
  }
}

@customElement('hmr-slots-frame')
export class HmrSlotsFrame extends LitElement {
  override render() {
    return html`<hmr-slots>
      <strong slot="title">Forwarded card</strong>
      <slot></slot>
    </hmr-slots>`;
  }
}
