import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';

/**
 * One property per declaration option the DevTools badges on a property:
 * custom `hasChanged`, custom `converter`, `noAccessor`, `useDefault` and
 * `attribute: false`.
 */
@customElement('hmr-property-options')
export class HmrPropertyOptions extends LitElement {
  static override styles = css`
    p {
      margin: 0.25rem 0;
    }
    button:focus {
      outline: 2px solid dodgerblue;
    }
  `;

  /** Only counts as changed when it moves by at least 5. */
  @property({
    type: Number,
    hasChanged: (value: number, old: number | undefined) =>
      old === undefined || Math.abs(value - old) >= 5,
  })
  coarse = 0;

  /** `a,b,c` attribute becomes an array. */
  @property({
    converter: {
      fromAttribute: (value: string | null) => value?.split(',') ?? [],
      toAttribute: (value: string[]) => value.join(','),
    },
  })
  tags: string[] = ['a', 'b'];

  /** No generated accessor: the manual one below requests the update. */
  @property({noAccessor: true})
  get manual() {
    return this.#manual;
  }
  set manual(value: number) {
    const old = this.#manual;
    this.#manual = value;
    this.requestUpdate('manual', old);
  }
  #manual = 0;

  /** Attribute-less value reverts to the default instead of `null`. */
  @property({useDefault: true, reflect: true})
  size = 'medium';

  /** Not observed from an attribute. */
  @property({attribute: false})
  data: {note: string} = {note: 'property only'};

  override render() {
    return html`
      <h2>Property options</h2>
      <p>
        hasChanged: ${this.coarse}
        <button @click=${() => (this.coarse += 1)}>+1</button>
        <button @click=${() => (this.coarse += 5)}>+5</button>
      </p>
      <p>converter: ${this.tags.join(' | ')}</p>
      <p>
        noAccessor: ${this.manual}
        <button @click=${() => this.manual++}>+1</button>
      </p>
      <p>
        useDefault: ${this.size}
        <button
          @click=${() => (this.size = this.size === 'medium' ? 'large' : 'medium')}
        >
          toggle
        </button>
      </p>
      <p>attribute: false: ${this.data.note}</p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hmr-property-options': HmrPropertyOptions;
  }
}
