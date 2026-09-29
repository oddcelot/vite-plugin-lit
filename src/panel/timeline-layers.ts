import {LitElement, html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {tokens} from '../lib/tokens.js';

export interface LayerState {
  id: string;
  label: string;
  color: number;
  enabled: boolean;
}

/** A layer's `0xRRGGBB` colour as a CSS hex string. */
export const hexColor = (color: number): string =>
  '#' + color.toString(16).padStart(6, '0');

/** CSS colour of layer `id`, grey for a layer `layers` does not know. */
export const layerColor = (
  layers: readonly LayerState[],
  id: string
): string => {
  const layer = layers.find((l) => l.id === id);
  return layer ? hexColor(layer.color) : '#888';
};

/**
 * Strip of colored pill toggles — one per timeline layer.
 *
 * Used twice by `timeline-view`: once for the capture toggles, and in Tracks
 * mode once more for which lanes to draw. `caption` labels the strip so the
 * two are not mistaken for each other.
 */
@customElement('timeline-layers')
export class TimelineLayers extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        gap: var(--lit-devtools-space-2);
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      button {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-4);
        border-radius: var(--lit-devtools-radius-pill);
        background: var(--lit-devtools-surface-elevated);
        border: 1px solid transparent;
        color: var(--lit-devtools-text-secondary);
        font-size: var(--lit-devtools-text-2xs);
        cursor: pointer;
        user-select: none;
        transition: opacity var(--lit-devtools-dur-fast)
          var(--lit-devtools-ease-standard);
      }
      button.on {
        color: var(--lit-devtools-text);
      }
      button:hover {
        background: var(--lit-devtools-surface-hover);
      }
      .caption {
        align-self: center;
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-2xs);
        margin-right: var(--lit-devtools-space-2);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        opacity: 0.4;
      }
      button.on .dot {
        opacity: 1;
      }
    `,
  ];

  @property({type: Array}) layers: LayerState[] = [];
  /** Optional leading label, e.g. "Tracks". */
  @property() caption = '';

  private _toggle(id: string) {
    this.dispatchEvent(
      new CustomEvent<{id: string}>('layer-toggle', {
        detail: {id},
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    return html`${
      this.caption
        ? html`<span class="caption">${this.caption}</span>`
        : nothing
    }${this.layers.map(
      (l) => html`
        <button
          class=${l.enabled ? 'on' : ''}
          title=${l.enabled ? `Hide ${l.label}` : `Show ${l.label}`}
          @click=${() => this._toggle(l.id)}
        >
          <span class="dot" style=${'background:' + hexColor(l.color)}></span>
          ${l.label}
        </button>
      `
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-layers': TimelineLayers;
  }
}
