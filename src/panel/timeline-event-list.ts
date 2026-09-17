/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import {repeat} from 'lit/directives/repeat.js';
import {tokens} from '../lib/tokens.js';
import type {TimelineEvent} from '../types/timeline.js';
import {toSpans} from '../lib/timeline/derive.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
import type {LayerState} from './timeline-layers.js';
import {openInEditor} from './open-in-editor.js';

/**
 * Adapts one raw event to the row shape for the Raw toggle. Deliberately
 * drops `groupId`: pairing is what the collapsed mode is for, and without it
 * the duration cell reads "point event" rather than "still open".
 */
const rawRow = (event: TimelineEvent, index: number): TimelineSpan => ({
  layerId: event.layerId,
  key: `raw:${index}`,
  name: event.title ?? event.layerId,
  start: event.time,
  subtitle: event.subtitle,
  logType: event.logType,
  meta: event.meta,
  events: [event],
});

/** Lit updates are routinely sub-millisecond, so one decimal is not enough. */
const formatMs = (ms: number): string =>
  ms < 1 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(1)}ms`;

const renderDuration = (row: TimelineSpan): string => {
  if (row.duration !== undefined) return formatMs(row.duration);
  // A span with a pairing id but no end is still running, or its end fell out
  // of the buffer. A point event never had one to wait for.
  return row.groupId === undefined ? '' : '…';
};

/**
 * Scrollable list of recorded timeline events with an inline detail pane.
 *
 * Rows are {@link TimelineSpan}s by default, not raw events: the capture
 * layers emit a start and an end per phase, so one update tick of one
 * component is five to ten raw rows whose durations the reader would
 * otherwise subtract by hand. The **Raw** toggle restores the per-event view
 * for ordering questions and for custom layers the pairing rules do not model.
 */
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
        gap: var(--lit-devtools-space-3);
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
        flex-shrink: 0;
      }
      .filterbar select {
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text);
        border: 1px solid var(--lit-devtools-border-strong);
        border-radius: var(--lit-devtools-radius-sm);
        padding: var(--lit-devtools-space-1) var(--lit-devtools-space-3);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
      }
      .filterbar input.regex {
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text);
        border: 1px solid var(--lit-devtools-border-strong);
        border-radius: var(--lit-devtools-radius-sm);
        padding: var(--lit-devtools-space-1) var(--lit-devtools-space-3);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
        min-width: 140px;
      }
      .filterbar input.regex::placeholder {
        color: var(--lit-devtools-text-muted);
      }
      .filterbar input.regex.invalid {
        border-color: var(--lit-devtools-error);
      }
      .filterbar button {
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text-muted);
        border: 1px solid var(--lit-devtools-border-strong);
        border-radius: var(--lit-devtools-radius-sm);
        padding: var(--lit-devtools-space-1) var(--lit-devtools-space-3);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
        cursor: pointer;
      }
      .filterbar button.on {
        color: var(--lit-devtools-text);
        border-color: var(--lit-devtools-accent);
      }
      .filterbar .count {
        margin-left: auto;
        color: var(--lit-devtools-text-muted);
      }
      .scroll {
        flex: 1;
        overflow-y: auto;
        padding: var(--lit-devtools-space-2) 0;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--lit-devtools-space-4);
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-xs);
      }
      .hint {
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
      }
      .row {
        display: flex;
        align-items: baseline;
        gap: var(--lit-devtools-space-4);
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
        border-bottom: 1px solid var(--lit-devtools-border);
        cursor: pointer;
      }
      .row:hover {
        background: var(--lit-devtools-surface-hover);
      }
      .row.selected {
        background: var(--lit-devtools-surface-active);
      }
      .time {
        color: var(--lit-devtools-text-muted);
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
        color: var(--lit-devtools-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .subtitle {
        color: var(--lit-devtools-text-muted);
        flex-shrink: 0;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .changed {
        color: var(--lit-devtools-accent);
        flex-shrink: 0;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dur {
        color: var(--lit-devtools-text-secondary);
        flex-shrink: 0;
        width: 62px;
        text-align: right;
      }
      .dur.open {
        color: var(--lit-devtools-text-muted);
      }
      .detail {
        border-top: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        padding: var(--lit-devtools-space-5) var(--lit-devtools-space-5);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
        color: var(--lit-devtools-text-secondary);
        flex-shrink: 0;
        max-height: 130px;
        overflow-y: auto;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      td {
        padding: var(--lit-devtools-space-1) var(--lit-devtools-space-4)
          var(--lit-devtools-space-1) 0;
        vertical-align: top;
      }
      .key {
        color: var(--lit-devtools-text-muted);
        white-space: nowrap;
      }
      .val {
        color: var(--lit-devtools-text);
        word-break: break-all;
      }
      a {
        color: var(--lit-devtools-accent);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .src-link {
        cursor: pointer;
      }
      .filter-link {
        cursor: pointer;
        margin-left: var(--lit-devtools-space-4);
        font-size: var(--lit-devtools-text-2xs);
      }
    `,
  ];

  @property({type: Array}) events: TimelineEvent[] = [];
  @property({type: Array}) layers: LayerState[] = [];
  /** Key of the selected row. Keys survive re-derivation; the row objects
   *  themselves are rebuilt whenever the event buffer changes. */
  @state() private _selectedKey: string | null = null;
  /** Element id to filter the list to, or null for all elements. */
  @state() private _elementFilter: number | null = null;
  /** Case-insensitive regex (source text) matched against tag/title/subtitle. */
  @state() private _regex = '';
  /** One row per raw event instead of one per collapsed span. */
  @state() private _raw = false;

  private readonly _scrollRef = createRef<HTMLDivElement>();
  /** Distinct elements seen in `events`, recomputed only when `events` changes
   *  (not on every render driven by selection/filter/regex state). */
  private _elementsCache: Array<{id: number; tag: string}> = [];
  /** Rows for the current mode, recomputed on the same terms as
   *  `_elementsCache` — deriving in `render()` would re-pair the whole buffer
   *  on every keystroke in the regex box. */
  private _rowsCache: TimelineSpan[] = [];

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('events') || changed.has('_raw')) {
      this._rowsCache = this._raw
        ? this.events.map(rawRow)
        : toSpans(this.events);
      // The selected row can vanish under either change: collapsing merges two
      // rows into one, and an old event falls out of the buffer cap.
      if (
        this._selectedKey !== null &&
        !this._rowsCache.some((row) => row.key === this._selectedKey)
      ) {
        this._selectedKey = null;
      }
    }
    if (changed.has('events')) {
      this._elementsCache = this._computeElements();
      // Drop a stale element filter when its element is no longer in the events
      // (e.g. after Clear), otherwise the list would silently show nothing.
      if (
        this._elementFilter !== null &&
        !this.events.some((ev) => ev.meta?.elementId === this._elementFilter)
      ) {
        this._elementFilter = null;
      }
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

  private _isVisible(row: TimelineSpan): boolean {
    const l = this.layers.find((l) => l.id === row.layerId);
    if (l && !l.enabled) return false;
    if (
      this._elementFilter !== null &&
      row.meta?.elementId !== this._elementFilter
    ) {
      return false;
    }
    return true;
  }

  /** Distinct elements (by stable id) seen across the recorded events. */
  private _computeElements(): Array<{id: number; tag: string}> {
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

  /** Text searched by the regex filter — element tag, name, subtitle and the
   *  changed property keys (the reason is worth searching for by name). */
  private _haystack(row: TimelineSpan): string {
    return `${row.meta?.tagName ?? ''} ${row.name} ${row.subtitle ?? ''} ${(
      row.changed ?? []
    ).join(' ')}`;
  }

  override render() {
    const elements = this._elementsCache;
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
    const visible = this._rowsCache.filter(
      (row) =>
        this._isVisible(row) && (re === null || re.test(this._haystack(row)))
    );
    const selected =
      this._selectedKey === null
        ? undefined
        : this._rowsCache.find((row) => row.key === this._selectedKey);
    return html`
      ${
        this.events.length > 0
          ? html`
              <div class="filterbar">
                ${
                  elements.length > 0
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
                    : nothing
                }
                <input
                  class="regex ${regexInvalid ? 'invalid' : ''}"
                  type="text"
                  spellcheck="false"
                  placeholder="filter regex…"
                  title="Case-insensitive regex matched against element tag, title and subtitle"
                  .value=${this._regex}
                  @input=${this._onRegexInput}
                />
                <button
                  class=${this._raw ? 'on' : ''}
                  title="Show one row per recorded event instead of collapsing start/end pairs"
                  @click=${() => {
                    this._raw = !this._raw;
                  }}
                >
                  Raw
                </button>
                <span class="count"
                  >${visible.length} / ${this._rowsCache.length}</span
                >
              </div>
            `
          : nothing
      }
      <div class="scroll" ${ref(this._scrollRef)}>
        ${
          visible.length === 0
            ? html`
                <div class="empty">
                  <span>No events recorded.</span>
                  <span class="hint"
                    >Press Record then interact with the page.</span
                  >
                </div>
              `
            : repeat(
                visible,
                (row) => row.key,
                (row) => html`
                  <div
                    class="row ${
                      this._selectedKey === row.key ? 'selected' : ''
                    }"
                    @click=${() => {
                      this._selectedKey = row.key;
                    }}
                  >
                    <span class="time">${row.start.toFixed(1)}ms</span>
                    <span
                      class="dot"
                      style=${'background:' + this._colorOf(row.layerId)}
                    ></span>
                    <span class="title">${row.name}</span>
                    ${
                      row.changed?.length
                        ? html`<span class="changed"
                            >${row.changed.join(', ')}</span
                          >`
                        : nothing
                    }
                    <span class="subtitle">${row.subtitle ?? nothing}</span>
                    <span
                      class="dur ${row.duration === undefined ? 'open' : ''}"
                      >${renderDuration(row)}</span
                    >
                  </div>
                `
              )
        }
      </div>
      ${selected ? this._renderDetail(selected) : nothing}
    `;
  }

  private _renderDetail(row: TimelineSpan) {
    const {meta} = row;
    const src = meta?.source;
    // Raw rows carry exactly one event; a collapsed span carries its start and
    // (once it closes) its end, whose payloads are the same minus `changed`.
    const data = row.events[0]?.data;
    return html`
      <div class="detail">
        <table>
          <tr>
            <td class="key">layer</td>
            <td class="val">${row.layerId}</td>
          </tr>
          <tr>
            <td class="key">time</td>
            <td class="val">${row.start.toFixed(3)} ms</td>
          </tr>
          ${
            row.duration !== undefined
              ? html`<tr>
                  <td class="key">duration</td>
                  <td class="val">${row.duration.toFixed(3)} ms</td>
                </tr>`
              : nothing
          }
          ${
            row.changed?.length
              ? html`<tr>
                  <td class="key">changed</td>
                  <td class="val">${row.changed.join(', ')}</td>
                </tr>`
              : nothing
          }
          ${
            meta?.tagName
              ? html`<tr>
                  <td class="key">element</td>
                  <td class="val">
                    &lt;${meta.tagName}&gt; #${meta.elementId}
                    ${
                      meta.elementId != null
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
                        : nothing
                    }
                  </td>
                </tr>`
              : nothing
          }
          ${
            src
              ? html`<tr>
                  <td class="key">source</td>
                  <td class="val">
                    <a
                      class="src-link"
                      title="Open this file in your editor"
                      @click=${() => openInEditor(src.file, src.line)}
                      >${src.file}:${src.line}</a
                    >
                  </td>
                </tr>`
              : nothing
          }
          ${
            data != null
              ? html`<tr>
                  <td class="key">data</td>
                  <td class="val">${JSON.stringify(data)}</td>
                </tr>`
              : nothing
          }
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
