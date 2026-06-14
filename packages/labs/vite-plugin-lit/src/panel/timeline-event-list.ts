/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import type {TimelineEvent} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';

/** Scrollable list of recorded timeline events with an inline detail pane. */
@customElement('timeline-event-list')
export class TimelineEventList extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }
    .filterbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-bottom: 1px solid #1e1e26;
      font-size: 11px;
      color: #888;
      flex-shrink: 0;
    }
    .filterbar select {
      background: #2d2d35;
      color: #d4d4d8;
      border: 1px solid #3d3d45;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      font-family: ui-monospace, monospace;
    }
    .filterbar input.regex {
      background: #2d2d35;
      color: #d4d4d8;
      border: 1px solid #3d3d45;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      min-width: 140px;
    }
    .filterbar input.regex::placeholder {
      color: #555;
    }
    .filterbar input.regex.invalid {
      border-color: #ef4444;
    }
    .filterbar .count {
      margin-left: auto;
      color: #555;
    }
    .scroll {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 8px;
      color: #555;
      font-size: 12px;
    }
    .hint {
      font-size: 10px;
      color: #444;
    }
    .row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 4px 12px;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      border-bottom: 1px solid #1e1e26;
      cursor: pointer;
    }
    .row:hover {
      background: #1e1e26;
    }
    .row.selected {
      background: #252530;
    }
    .time {
      color: #666;
      flex-shrink: 0;
      width: 56px;
      text-align: right;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .title {
      flex: 1;
      color: #d4d4d8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .subtitle {
      color: #666;
      flex-shrink: 0;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail {
      border-top: 1px solid #2d2d35;
      background: #16161b;
      padding: 10px 12px;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      color: #a0a0b0;
      flex-shrink: 0;
      max-height: 130px;
      overflow-y: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    td {
      padding: 2px 8px 2px 0;
      vertical-align: top;
    }
    .key {
      color: #666;
      white-space: nowrap;
    }
    .val {
      color: #d4d4d8;
      word-break: break-all;
    }
    a {
      color: #4fc08d;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .filter-link {
      cursor: pointer;
      margin-left: 8px;
      font-size: 10px;
    }
  `;

  @property({type: Array}) events: TimelineEvent[] = [];
  @property({type: Array}) layers: LayerState[] = [];
  @state() private _selected: TimelineEvent | null = null;
  /** Element id to filter the list to, or null for all elements. */
  @state() private _elementFilter: number | null = null;
  /** Case-insensitive regex (source text) matched against tag/title/subtitle. */
  @state() private _regex = '';

  private readonly _scrollRef = createRef<HTMLDivElement>();

  override willUpdate(changed: Map<string, unknown>) {
    // Drop a stale element filter when its element is no longer in the events
    // (e.g. after Clear), otherwise the list would silently show nothing.
    if (changed.has('events') && this._elementFilter !== null) {
      const present = this.events.some(
        (ev) => ev.meta?.elementId === this._elementFilter
      );
      if (!present) this._elementFilter = null;
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('events')) {
      const el = this._scrollRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  private _colorOf(layerId: string): string {
    const l = this.layers.find((l) => l.id === layerId);
    if (!l) return '#888';
    return '#' + l.color.toString(16).padStart(6, '0');
  }

  private _isVisible(ev: TimelineEvent): boolean {
    const l = this.layers.find((l) => l.id === ev.layerId);
    if (l && !l.enabled) return false;
    if (
      this._elementFilter !== null &&
      ev.meta?.elementId !== this._elementFilter
    ) {
      return false;
    }
    return true;
  }

  /** Distinct elements (by stable id) seen across the recorded events. */
  private _elements(): Array<{id: number; tag: string}> {
    const seen = new Map<number, string>();
    for (const ev of this.events) {
      const id = ev.meta?.elementId;
      if (id != null && !seen.has(id)) {
        seen.set(id, ev.meta?.tagName ?? 'unknown');
      }
    }
    return [...seen].map(([id, tag]) => ({id, tag}));
  }

  private _onFilterChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    this._elementFilter = v === '' ? null : Number(v);
  }

  /** Ask the panel shell to open the Components tab on this element. */
  private _inspect(id: number) {
    this.dispatchEvent(
      new CustomEvent('inspect-element', {
        detail: {id},
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onRegexInput(e: Event) {
    this._regex = (e.target as HTMLInputElement).value;
  }

  /** Text searched by the regex filter — element tag, title and subtitle. */
  private _haystack(ev: TimelineEvent): string {
    return `${ev.meta?.tagName ?? ''} ${ev.title ?? ''} ${ev.subtitle ?? ''}`;
  }

  override render() {
    const elements = this._elements();
    // Compile the regex once per render; invalid patterns disable the filter
    // (rather than hiding everything) and flag the input.
    let re: RegExp | null = null;
    let regexInvalid = false;
    if (this._regex !== '') {
      try {
        re = new RegExp(this._regex, 'i');
      } catch {
        regexInvalid = true;
      }
    }
    const visible = this.events.filter(
      (ev) =>
        this._isVisible(ev) && (re === null || re.test(this._haystack(ev)))
    );
    return html`
      ${this.events.length > 0
        ? html`
            <div class="filterbar">
              ${elements.length > 0
                ? html`
                    <span>Element:</span>
                    <select @change=${this._onFilterChange}>
                      <option
                        value=""
                        ?selected=${this._elementFilter === null}
                      >
                        All elements
                      </option>
                      ${elements.map(
                        (el) => html`
                          <option
                            value=${el.id}
                            ?selected=${this._elementFilter === el.id}
                          >
                            &lt;${el.tag}&gt; #${el.id}
                          </option>
                        `
                      )}
                    </select>
                  `
                : nothing}
              <input
                class="regex ${regexInvalid ? 'invalid' : ''}"
                type="text"
                spellcheck="false"
                placeholder="filter regex…"
                title="Case-insensitive regex matched against element tag, title and subtitle"
                .value=${this._regex}
                @input=${this._onRegexInput}
              />
              <span class="count"
                >${visible.length} / ${this.events.length}</span
              >
            </div>
          `
        : nothing}
      <div class="scroll" ${ref(this._scrollRef)}>
        ${visible.length === 0
          ? html`
              <div class="empty">
                <span>No events recorded.</span>
                <span class="hint"
                  >Press Record then interact with the page.</span
                >
              </div>
            `
          : visible.map(
              (ev) => html`
                <div
                  class="row ${this._selected === ev ? 'selected' : ''}"
                  @click=${() => {
                    this._selected = ev;
                  }}
                >
                  <span class="time">${ev.time.toFixed(1)}ms</span>
                  <span
                    class="dot"
                    style=${'background:' + this._colorOf(ev.layerId)}
                  ></span>
                  <span class="title">${ev.title ?? ev.layerId}</span>
                  <span class="subtitle">${ev.subtitle ?? nothing}</span>
                </div>
              `
            )}
      </div>
      ${this._selected ? this._renderDetail(this._selected) : nothing}
    `;
  }

  private _renderDetail(ev: TimelineEvent) {
    const {meta} = ev;
    const src = meta?.source;
    return html`
      <div class="detail">
        <table>
          <tr>
            <td class="key">layer</td>
            <td class="val">${ev.layerId}</td>
          </tr>
          <tr>
            <td class="key">time</td>
            <td class="val">${ev.time.toFixed(3)} ms</td>
          </tr>
          ${meta?.tagName
            ? html`<tr>
                <td class="key">element</td>
                <td class="val">
                  &lt;${meta.tagName}&gt; #${meta.elementId}
                  ${meta.elementId != null
                    ? html`<a
                          class="filter-link"
                          @click=${() => {
                            this._elementFilter = meta.elementId!;
                          }}
                          >filter</a
                        ><a
                          class="filter-link"
                          title="Open this element in the Components tab"
                          @click=${() => this._inspect(meta.elementId!)}
                          >inspect</a
                        >`
                    : nothing}
                </td>
              </tr>`
            : nothing}
          ${src
            ? html`<tr>
                <td class="key">source</td>
                <td class="val">
                  <a
                    href=${'/__lit-open-in-editor?file=' +
                    encodeURIComponent(src.file) +
                    '&line=' +
                    src.line}
                    target="_blank"
                    >${src.file}:${src.line}</a
                  >
                </td>
              </tr>`
            : nothing}
          ${ev.data != null
            ? html`<tr>
                <td class="key">data</td>
                <td class="val">${JSON.stringify(ev.data)}</td>
              </tr>`
            : nothing}
        </table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-event-list': TimelineEventList;
  }
}
