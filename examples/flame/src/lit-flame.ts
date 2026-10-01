import {LitElement, css, html, svg} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {styleMap} from 'lit/directives/style-map.js';

/**
 * The Lit flame, and three ways to play with it. Keep the page open and edit
 * this file: each save patches the running element instead of reloading it,
 * so whatever you set below is still there afterwards.
 *
 * - `hue` and `burning` are reactive state (`@state`).
 * - `#stokes` is a native private field, which the plugin keeps across
 *   patches too.
 * - The colours are oklch() custom properties in `styles`.
 */
@customElement('lit-flame')
export class LitFlame extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: light-dark(oklch(0.25 0.03 265), oklch(0.92 0.02 265));
    }

    .scene {
      /* The flame's four facets, turned by --shift (the hue slider). Change
         a lightness, a chroma or an offset and save: the flame recolours in
         place, with its state untouched. */
      --facet-glow: oklch(0.85 0.15 calc(205deg + var(--shift, 0deg)));
      --facet-core: oklch(0.91 0.16 calc(195deg + var(--shift, 0deg)));
      --facet-blue: oklch(0.52 0.26 calc(266deg + var(--shift, 0deg)));
      --facet-deep: oklch(0.36 0.17 calc(271deg + var(--shift, 0deg)));

      display: grid;
      justify-items: center;
      gap: 1.5rem;
      padding: 2rem;
    }

    svg {
      width: 10rem;
      height: 12.5rem;
      overflow: visible;
      transform-origin: 50% 100%;
      transform: scale(var(--size, 1));
      transition:
        transform 200ms ease-out,
        opacity 300ms;
    }
    .glow {
      fill: var(--facet-glow);
    }
    .core {
      fill: var(--facet-core);
    }
    .blue {
      fill: var(--facet-blue);
    }
    .deep {
      fill: var(--facet-deep);
    }

    .burning svg {
      animation: flicker 1.6s ease-in-out infinite alternate;
    }
    .out svg {
      opacity: 0.25;
      filter: grayscale(1);
    }
    @keyframes flicker {
      from {
        transform: scale(var(--size)) skewX(-1.5deg);
      }
      to {
        transform: scale(var(--size)) scaleY(1.04) skewX(1.5deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .burning svg {
        animation: none;
      }
    }

    .controls {
      display: grid;
      grid-template-columns: auto 12rem;
      align-items: center;
      gap: 0.75rem 1rem;
    }
    button {
      font: inherit;
      padding: 0.4rem 0.9rem;
      border-radius: 0.5rem;
      border: 1px solid var(--facet-blue);
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    button:hover {
      background: color-mix(in oklch, var(--facet-glow) 20%, transparent);
    }
    output {
      font-variant-numeric: tabular-nums;
    }
  `;

  /** Degrees every facet's hue is turned by. */
  @state() private hue = 0;

  /** Whether the flame flickers, or has been blown out. */
  @state() private burning = true;

  /**
   * How often the flame was stoked. A native private field: Lit does not
   * watch it, so {@link #stoke} asks for the update itself.
   */
  #stokes = 0;

  #stoke() {
    this.#stokes++;
    this.burning = true;
    this.requestUpdate();
  }

  override render() {
    // Each stoke makes the flame a little bigger, up to half again its size.
    const size = 1 + Math.min(this.#stokes, 10) * 0.05;
    return html`
      <div
        class="scene ${this.burning ? 'burning' : 'out'}"
        style=${styleMap({'--shift': `${this.hue}deg`, '--size': size})}
      >
        ${flame}
        <div class="controls">
          <label for="hue">Hue</label>
          <input
            id="hue"
            type="range"
            min="0"
            max="359"
            .value=${String(this.hue)}
            @input=${(e: Event) =>
              (this.hue = Number((e.target as HTMLInputElement).value))}
          />
          <button @click=${() => this.#stoke()}>Stoke</button>
          <output>stoked ${this.#stokes}×</output>
          <button @click=${() => (this.burning = !this.burning)}>
            ${this.burning ? 'Blow out' : 'Light'}
          </button>
        </div>
      </div>
    `;
  }
}

/** The Lit logo mark, one path per facet, so CSS can colour each. */
const flame = svg`
  <svg viewBox="0 0 160 200" role="img" aria-label="Lit flame">
    <path class="glow" d="M40 120l20-60l90 90l-30 50l-40-40h-20" />
    <path class="deep" d="M80 160v-80l40-40v80M0 160l40 40l20-40l-20-40h-20" />
    <path class="blue" d="M40 120v-80l40-40v80M120 200v-80l40-40v80M0 160v-80l40 40" />
    <path class="core" d="M40 200v-80l40 40" />
  </svg>
`;

declare global {
  interface HTMLElementTagNameMap {
    'lit-flame': LitFlame;
  }
}
