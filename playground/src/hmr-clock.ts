/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {SignalWatcher, html, svg} from '@lit-labs/signals';
import {getTimeParts, now, timeZone} from './clock-signal.js';

/**
 * An SVG clock driven by the shared `now` signal. The face and the hands
 * are separate `svg` literals, so an edit to one leaves the other's DOM
 * untouched — while the clock keeps ticking through the patch.
 *
 * Colors are themeable two ways:
 * - CSS custom properties (`--clock-face`, `--clock-tick`, `--clock-hour`,
 *   `--clock-minute`, `--clock-second`) — edit the defaults below for a hot
 *   restyle.
 * - CSS shadow parts (`face`, `tick`, `hour`, `minute`, `second`), e.g.
 *   `hmr-clock::part(second) { stroke: hotpink; }` from the page.
 */
@customElement('hmr-clock')
export class HmrClock extends SignalWatcher(LitElement) {
  static override styles = css`
    svg {
      width: 140px;
      height: 140px;
    }
    #face {
      fill: var(--clock-face, #f1faee);
      stroke: var(--clock-rim, #1d3557);
      stroke-width: 2;
    }
    .tick {
      stroke: var(--clock-tick, #457b9d);
      stroke-width: 1.5;
    }
    #hour-hand {
      stroke: var(--clock-hour, #1d3557);
      stroke-width: 3;
      stroke-linecap: round;
    }
    #minute-hand {
      stroke: var(--clock-minute, #457b9d);
      stroke-width: 2;
      stroke-linecap: round;
    }
    #second-hand {
      stroke: var(--clock-second, #e63946);
      stroke-width: 1;
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  private renders = 0;

  private renderFace() {
    const ticks = [];
    for (let i = 0; i < 12; i++) {
      ticks.push(
        svg`<line
          class="tick"
          part="tick"
          x1="50"
          y1="4"
          x2="50"
          y2="${i % 3 === 0 ? 12 : 8}"
          transform="rotate(${i * 30} 50 50)"
        ></line>`
      );
    }
    return svg`
      <circle id="face" part="face" cx="50" cy="50" r="48"></circle>
      ${ticks}
    `;
  }

  private renderHands(time: Date) {
    // Follows the shared timezone signal (see the digital clock's picker).
    const parts = getTimeParts(time, timeZone.get());
    const seconds = parts.seconds;
    const minutes = parts.minutes + seconds / 60;
    const hours = (parts.hours % 12) + minutes / 60;
    return svg`
      <line id="hour-hand" part="hour" x1="50" y1="50" x2="50" y2="28"
        transform="rotate(${hours * 30} 50 50)"></line>
      <line id="minute-hand" part="minute" x1="50" y1="50" x2="50" y2="16"
        transform="rotate(${minutes * 6} 50 50)"></line>
      <line id="second-hand" part="second" x1="50" y1="54" x2="50" y2="10"
        transform="rotate(${seconds * 6} 50 50)"></line>
    `;
  }

  override render() {
    // Reading the signal inside render() is enough — SignalWatcher tracks
    // it and re-renders on every tick.
    const time = now.get();
    return html`
      <h2>Clock: HELLO</h2>
      <svg viewBox="0 0 100 100" role="img" aria-label="analog clock">
        ${this.renderFace()} ${this.renderHands(time)}
      </svg>
      <span class="badge" id="badge">renders: 0</span>
    `;
  }

  override updated() {
    this.renders++;
    this.setAttribute('data-renders', String(this.renders));
    const badge = this.renderRoot.querySelector('#badge');
    if (badge !== null) {
      badge.textContent = `renders: ${this.renders}`;
    }
  }
}
