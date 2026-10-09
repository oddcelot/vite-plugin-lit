import {LitElement, html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import './wa-icons.js';
import {tokens} from '../lib/tokens.js';
import {describeRange, formatMs} from '../lib/timeline/range.js';
import type {RangeSummary} from '../lib/timeline/range.js';
import {layerColor} from './timeline-layers.js';
import type {LayerState} from './timeline-layers.js';

/**
 * Detail pane for a selected time range: how long it is, how many events each
 * layer recorded in it, and which components updated, how often and for how
 * long. A span belongs to the range when it *starts* inside it.
 *
 * Shown by the Tracks presentation when no single span is selected. It only
 * reports: **zoom** and **filter** are `range-zoom` / `range-filter` events,
 * **clear** is `range-clear`, and a component row's **filter** and **inspect**
 * reuse the span detail's `element-filter` / `inspect-element` events (a
 * component with several instances offers only **inspect**, on its first,
 * because the element filter names one).
 */
@customElement('timeline-range-summary')
export class TimelineRangeSummary extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: block;
        border-top: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        padding: var(--lit-devtools-space-5);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
        color: var(--lit-devtools-text-secondary);
        flex-shrink: 0;
        max-height: 150px;
        overflow-y: auto;
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-3);
        margin-bottom: var(--lit-devtools-space-3);
      }
      h3 {
        margin: 0;
        font-size: inherit;
        font-weight: 600;
        color: var(--lit-devtools-text);
      }
      .spacer {
        flex: 1;
      }
      .layers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--lit-devtools-space-4);
        margin-bottom: var(--lit-devtools-space-3);
      }
      .dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        margin-right: var(--lit-devtools-space-2);
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th {
        text-align: left;
        font-weight: normal;
        color: var(--lit-devtools-text-muted);
      }
      th,
      td {
        padding: var(--lit-devtools-space-1) var(--lit-devtools-space-4)
          var(--lit-devtools-space-1) 0;
      }
      td.num {
        text-align: right;
      }
      .val {
        color: var(--lit-devtools-text);
      }
      .note {
        color: var(--lit-devtools-text-muted);
      }
    `,
  ];

  @property({attribute: false}) summary: RangeSummary | undefined;
  @property({attribute: false}) layers: LayerState[] = [];

  private _emit(type: string, detail?: unknown) {
    this.dispatchEvent(
      new CustomEvent(type, {detail, bubbles: true, composed: true})
    );
  }

  override render() {
    const s = this.summary;
    if (!s) return nothing;
    const label = (id: string) =>
      this.layers.find((l) => l.id === id)?.label ?? id;
    return html`
      <header>
        <h3>Range ${describeRange(s.range)}</h3>
        <span class="note"
          >${s.spanCount} ${s.spanCount === 1 ? 'event' : 'events'} starting in
          it</span
        >
        <span class="spacer"></span>
        <wa-button
          class="zoom"
          size="small"
          appearance="outlined"
          data-tip="Fit the view to this range"
          @click=${() => this._emit('range-zoom')}
          >Zoom to range</wa-button
        >
        <wa-button
          class="filter"
          size="small"
          appearance="outlined"
          data-tip="Show only this range in the list and the tracks"
          @click=${() => this._emit('range-filter')}
          >Filter to range</wa-button
        >
        <wa-button
          class="clear"
          size="small"
          appearance="plain"
          data-tip="Clear the range (Esc)"
          @click=${() => this._emit('range-clear')}
          >Clear</wa-button
        >
      </header>
      <div class="layers">
        ${s.layers.map(
          (l) => html`<span
            ><span
              class="dot"
              style="background:${layerColor(this.layers, l.layerId)}"
            ></span
            >${label(l.layerId)} <span class="val">${l.count}</span></span
          >`
        )}
      </div>
      ${
        s.components.length === 0
          ? html`<div class="note">No component updated in this range.</div>`
          : html`<table>
              <tr>
                <th>component</th>
                <th class="num">updates</th>
                <th class="num">total</th>
                <th></th>
              </tr>
              ${s.components.map((c) => {
                const first = c.elementIds[0];
                return html`<tr class="component">
                  <td class="val">&lt;${c.tagName}&gt;</td>
                  <td class="num val">${c.updates}</td>
                  <td class="num val">${formatMs(c.totalMs)}</td>
                  <td>
                    ${
                      c.elementIds.length === 1 && first !== undefined
                        ? html`<wa-button
                            class="filter-link"
                            size="small"
                            appearance="plain"
                            data-tip="Show only events from this element"
                            @click=${() =>
                              this._emit('element-filter', {id: first})}
                            >filter</wa-button
                          >`
                        : nothing
                    }${
                      first !== undefined
                        ? html`<wa-button
                            class="inspect-link"
                            size="small"
                            appearance="plain"
                            data-tip="Open this element in the Components tab"
                            @click=${() =>
                              this._emit('inspect-element', {id: first})}
                            >inspect</wa-button
                          >`
                        : nothing
                    }
                  </td>
                </tr>`;
              })}
            </table>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-range-summary': TimelineRangeSummary;
  }
}
