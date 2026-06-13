/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {SignalWatcher, html} from '@lit-labs/signals';
import {TIME_ZONES, now, timeZone} from './clock-signal.js';

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

const formatTime = (date: Date, tz: string): string => {
  let formatter = displayFormatters.get(tz);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeStyle: 'medium',
      timeZone: tz,
    });
    displayFormatters.set(tz, formatter);
  }
  return formatter.format(date);
};

/**
 * Digital clock on the same shared `now` signal as the analog one, plus a
 * shared `timeZone` signal formatted via `Intl.DateTimeFormat`. The
 * timezone picker is a searchable `<input list>`/`<datalist>` over every
 * IANA zone the runtime supports (`Intl.supportedValuesOf('timeZone')`) —
 * picking one swings the analog clock too.
 *
 * Display and picker are separate `html` literals: editing one leaves the
 * other's DOM (and the picker's input state) untouched.
 */
@customElement('hmr-digital-clock')
export class HmrDigitalClock extends SignalWatcher(LitElement) {
  static override styles = css`
    #digital {
      display: block;
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 2rem;
      color: var(--digital-color, var(--fg, #1d3557));
    }
    #tz {
      color: var(--muted, #666);
      font-size: 0.85em;
    }
    label {
      display: block;
      margin-top: 0.75rem;
    }
    input {
      width: 14rem;
    }
    input:focus {
      outline: 2px solid dodgerblue;
    }
    .badge {
      font-size: 0.8em;
      color: var(--muted, #666);
    }
  `;

  private renders = 0;

  private renderDisplay() {
    return html`
      <time id="digital">${formatTime(now.get(), timeZone.get())}</time>
      <span id="tz">${timeZone.get()}</span>
    `;
  }

  private renderPicker() {
    return html`
      <label>
        Timezone:
        <input
          id="tz-input"
          list="tz-list"
          placeholder="type to search…"
          .value=${timeZone.get()}
          @change=${this.onTimeZoneChange}
        />
      </label>
      <datalist id="tz-list">
        ${TIME_ZONES.map((tz) => html`<option value=${tz}></option>`)}
      </datalist>
    `;
  }

  override render() {
    return html`
      <h2>Digital: HELLO</h2>
      ${this.renderDisplay()} ${this.renderPicker()}
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

  private onTimeZoneChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (TIME_ZONES.includes(input.value)) {
      timeZone.set(input.value);
    }
  }
}
