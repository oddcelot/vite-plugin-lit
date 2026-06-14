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
  `;

  @property({type: Array}) events: TimelineEvent[] = [];
  @property({type: Array}) layers: LayerState[] = [];
  @state() private _selected: TimelineEvent | null = null;

  private readonly _scrollRef = createRef<HTMLDivElement>();

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
    return l ? l.enabled : true;
  }

  override render() {
    const visible = this.events.filter((ev) => this._isVisible(ev));
    return html`
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
                <td class="val">&lt;${meta.tagName}&gt; #${meta.elementId}</td>
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
