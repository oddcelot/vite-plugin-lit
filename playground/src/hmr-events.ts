import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

interface Pick {
  id: number;
  label: string;
}

/**
 * Dispatches a bubbling, composed `pick` CustomEvent per click, so the
 * DevTools Timeline's custom-events layer records it with its `detail`.
 */
@customElement('hmr-events-picker')
export class HmrEventsPicker extends LitElement {
  static override styles = css`
    button {
      margin-right: 0.35rem;
    }
    button:focus {
      outline: 2px solid dodgerblue;
    }
  `;

  private static readonly options: Pick[] = [
    {id: 1, label: 'Apple'},
    {id: 2, label: 'Banana'},
    {id: 3, label: 'Cherry'},
  ];

  override render() {
    return html`${HmrEventsPicker.options.map(
      (option) =>
        html`<button @click=${() => this.pick(option)}>${option.label}</button>`
    )}`;
  }

  private pick(detail: Pick) {
    this.dispatchEvent(
      new CustomEvent('pick', {detail, bubbles: true, composed: true})
    );
  }
}

/**
 * Listens for `pick` from its child and re-renders with the value, so the
 * event and the update it causes sit next to each other on the Timeline.
 */
@customElement('hmr-events')
export class HmrEvents extends LitElement {
  @state()
  private picked: Pick | undefined;

  override render() {
    return html`
      <h2>Custom events</h2>
      <hmr-events-picker
        @pick=${(e: CustomEvent<Pick>) => (this.picked = e.detail)}
      ></hmr-events-picker>
      <p id="picked">
        Picked:
        ${this.picked ? `${this.picked.label} (#${this.picked.id})` : '(nothing yet)'}
      </p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hmr-events': HmrEvents;
    'hmr-events-picker': HmrEventsPicker;
  }
}
