import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import theme from './theme.css?css-sheet';

@customElement('my-element')
export class MyElement extends LitElement {
  static styles = [
    theme,
    css`
      :host {
        display: block;
        max-width: 32rem;
        margin: 3rem auto;
        font-family: system-ui, sans-serif;
      }

      input:focus {
        outline: 2px solid currentColor;
      }
    `,
  ];

  @state() private count = 0;
  @state() private notes: string[] = [];

  private renderHeader() {
    return html`<h1>My notes</h1>`;
  }

  private renderList() {
    return html`<ul>
      ${this.notes.map((note) => html`<li class="card">${note}</li>`)}
    </ul>`;
  }

  render() {
    return html`
      ${this.renderHeader()}
      <input placeholder="Type a note, press Enter" @keydown=${this.onKey} />
      ${this.renderList()}
      <button @click=${this.onClick}>Clicked ${this.count} times</button>
    `;
  }

  private onClick() {
    this.count++;
  }

  private onKey(event: KeyboardEvent) {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Enter' && input.value) {
      this.notes = [...this.notes, input.value];
      input.value = '';
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'my-element': MyElement;
  }
}
