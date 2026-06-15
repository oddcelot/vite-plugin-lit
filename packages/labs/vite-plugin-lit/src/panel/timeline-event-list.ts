/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import {tokens} from '../lib/tokens.js';
import type {TimelineEvent} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';

/** Scrollable list of recorded timeline events with an inline detail pane. */
@customElement('timeline-event-list')
export class TimelineEventList extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
      .filterbar {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-5);
        border-bottom: 1px solid var(--border);
        font-size: var(--text-2xs);
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .filterbar select {
        background: var(--surface-elevated);
        color: var(--text);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-3);
        font-size: var(--text-2xs);
        font-family: var(--font-mono);
      }
      .filterbar input.regex {
        background: var(--surface-elevated);
        color: var(--text);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-3);
        font-size: var(--text-2xs);
        font-family: var(--font-mono);
        min-width: 140px;
      }
      .filterbar input.regex::placeholder {
        color: var(--text-muted);
      }
      .filterbar input.regex.invalid {
        border-color: var(--error);
      }
      .filterbar .count {
        margin-left: auto;
        color: var(--text-muted);
      }
      .scroll {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-2) 0;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--space-4);
        color: var(--text-muted);
        font-size: var(--text-xs);
      }
      .hint {
        font-size: var(--text-2xs);
        color: var(--text-muted);
      }
      .row {
        display: flex;
        align-items: baseline;
        gap: var(--space-4);
        padding: var(--space-2) var(--space-5);
        font-size: var(--text-2xs);
        font-family: var(--font-mono);
        border-bottom: 1px solid var(--border);
        cursor: pointer;
      }
      .row:hover {
        background: var(--surface-hover);
      }
      .row.selected {
        background: var(--surface-active);
      }
      .time {
        color: var(--text-muted);
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
        color: var(--text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .subtitle {
        color: var(--text-muted);
        flex-shrink: 0;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .detail {
        border-top: 1px solid var(--border);
        background: var(--surface-low);
        padding: var(--space-5) var(--space-5);
        font-size: var(--text-2xs);
        font-family: var(--font-mono);
        color: var(--text-secondary);
        flex-shrink: 0;
        max-height: 130px;
        overflow-y: auto;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      td {
        padding: var(--space-1) var(--space-4) var(--space-1) 0;
        vertical-align: top;
      }
      .key {
        color: var(--text-muted);
        white-space: nowrap;
      }
      .val {
        color: var(--text);
        word-break: break-all;
      }
      a {
        color: var(--accent);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .filter-link {
        cursor: pointer;
        margin-left: var(--space-4);
        font-size: var(--text-2xs);
      }
    `,
  ];

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
