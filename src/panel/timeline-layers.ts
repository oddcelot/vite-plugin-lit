import {LitElement, html, css, nothing} from 'lit';
import type {TemplateResult} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import './wa-icons.js';
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

/** Styles for {@link renderEmptyState}; the list and the tracks both adopt them. */
export const emptyStateStyles = css`
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    box-sizing: border-box;
    height: 100%;
    gap: var(--lit-devtools-space-3);
    padding: var(--lit-devtools-space-5);
    text-align: center;
    font-family: var(--lit-devtools-font-sans);
    font-size: var(--lit-devtools-text-xs);
    color: var(--lit-devtools-text-muted);
  }
  .empty .hint {
    font-size: var(--lit-devtools-text-2xs);
    color: var(--lit-devtools-text-muted);
  }
  .empty wa-button {
    margin-top: var(--lit-devtools-space-3);
  }
  .empty wa-button::part(base) {
    height: var(--lit-devtools-control-height, 28px);
  }
`;

/**
 * The Timeline's empty state, shared by List and Tracks. The Record button is
 * only offered when `onRecord` is given (the host can record and is not
 * already); the presentations forward its click as `record-request`.
 */
export const renderEmptyState = (onRecord?: () => void): TemplateResult =>
  html`<div class="empty">
    <span>No events yet</span>
    <span class="hint"
      >Interact with the page, or press Record to capture a session.</span
    >
    ${
      onRecord
        ? html`<wa-button size="small" appearance="outlined" @click=${onRecord}>
            <wa-icon slot="start" name="record"></wa-icon>
            Start recording
          </wa-button>`
        : nothing
    }
  </div>`;

/**
 * Strip of colored toggle chips, one per timeline layer. On is a solid swatch
 * and normal text over a faint fill; off is a hollow swatch, muted text and no
 * fill. Each chip is a button with `aria-pressed`.
 *
 * Used twice by `timeline-view`: once for the capture toggles, and in Tracks
 * mode once more, `compact`, for which lanes to draw. `caption` labels the
 * strip so the two are not mistaken for each other.
 */
@customElement('timeline-layers')
export class TimelineLayers extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      /* The secondary strip sits inside the filter bar, not in a bar of its own. */
      :host([compact]) {
        padding: 0;
        border-bottom: 0;
        background: none;
      }
      .caption {
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-2xs);
        margin-right: var(--lit-devtools-space-2);
      }
      .chip {
        --layer: #888;
        display: inline-flex;
        align-items: center;
        gap: var(--lit-devtools-space-3);
        box-sizing: border-box;
        height: var(--lit-devtools-control-height, 28px);
        padding: 0 var(--lit-devtools-space-4);
        border: 1px solid var(--lit-devtools-border);
        border-radius: var(--lit-devtools-radius-pill, 999px);
        background: var(--lit-devtools-surface-container-high);
        color: var(--lit-devtools-text);
        font: inherit;
        font-size: var(--lit-devtools-text-xs);
        white-space: nowrap;
        cursor: pointer;
      }
      .chip:hover {
        border-color: var(--lit-devtools-border-strong);
      }
      .chip:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
        outline-offset: 1px;
      }
      .chip[aria-pressed='false'] {
        background: transparent;
        color: var(--lit-devtools-text-muted);
      }
      :host([compact]) .chip {
        height: var(--lit-devtools-row-height, 22px);
        padding: 0 var(--lit-devtools-space-3);
        background: transparent;
        font-size: var(--lit-devtools-text-2xs);
      }
      .dot {
        width: 8px;
        height: 8px;
        box-sizing: border-box;
        flex-shrink: 0;
        background: var(--layer);
        border: 1px solid var(--layer);
      }
      .chip[aria-pressed='false'] .dot {
        background: transparent;
      }
    `,
  ];

  @property({type: Array}) layers: LayerState[] = [];
  /** Optional leading label, e.g. "Show as tracks". */
  @property() caption = '';
  /** The smaller, outline-only variant for a secondary strip. */
  @property({type: Boolean, reflect: true}) compact = false;

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
          type="button"
          class="chip ${l.enabled ? 'on' : ''}"
          aria-pressed=${l.enabled ? 'true' : 'false'}
          data-tip=${l.enabled ? `Hide ${l.label}` : `Show ${l.label}`}
          @click=${() => this._toggle(l.id)}
        >
          <span class="dot" style=${'--layer:' + hexColor(l.color)}></span>
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
