import {LitElement, html, css, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import {tokens} from '../lib/tokens.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
import {openInEditor} from './open-in-editor.js';

/**
 * Detail pane for one selected timeline span: layer, time, duration, changed
 * properties, element, source and raw data.
 *
 * Shared by the List and Tracks presentations of the Timeline so a selection
 * reads the same in both. The **filter** link only makes sense where there is
 * an element filter to set, so it is shown when `filterable` is set and
 * reported as an `element-filter` event; **inspect** bubbles an
 * `inspect-element` event up to the panel shell.
 */
@customElement('timeline-span-detail')
export class TimelineSpanDetail extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: block;
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
      .filter-link {
        margin-left: var(--lit-devtools-space-4);
      }
      .badge {
        margin-left: var(--lit-devtools-space-4);
      }
    `,
  ];

  @property({attribute: false}) span: TimelineSpan | undefined;
  /** Offer the **filter** link (both presentations honour the element filter). */
  @property({type: Boolean}) filterable = false;

  private _emit(type: 'element-filter' | 'inspect-element', id: number) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: {id},
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    const row = this.span;
    if (!row) return nothing;
    const {meta} = row;
    const src = meta?.source;
    // Raw rows carry exactly one event; a collapsed span carries its start and
    // (once it closes) its end, whose payloads are the same minus `changed`.
    const data = row.events[0]?.data;
    const id = meta?.elementId;
    return html`
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
          row.changedDetail?.length
            ? html`<tr>
                <td class="key">values</td>
                <td class="val">
                  ${row.changedDetail.map(
                    (c) => html`<div>
                      ${c.key}: ${c.prev} →
                      ${c.next}${
                        c.sameRef
                          ? html`<wa-badge
                              class="badge"
                              variant="neutral"
                              appearance="filled"
                              >same reference</wa-badge
                            >`
                          : c.equal
                            ? html`<wa-badge
                                class="badge"
                                variant="neutral"
                                appearance="filled"
                                >new reference, same value</wa-badge
                              >`
                            : nothing
                      }
                    </div>`
                  )}
                </td>
              </tr>`
            : nothing
        }
        ${
          meta?.tagName
            ? html`<tr>
                <td class="key">element</td>
                <td class="val">
                  &lt;${meta.tagName}&gt; #${id}
                  ${
                    id != null && this.filterable
                      ? html`<wa-button
                          class="filter-link"
                          size="small"
                          appearance="plain"
                          @click=${() => this._emit('element-filter', id)}
                          >filter</wa-button
                        >`
                      : nothing
                  }${
                    id != null
                      ? html`<wa-button
                          class="filter-link"
                          size="small"
                          appearance="plain"
                          title="Open this element in the Components tab"
                          @click=${() => this._emit('inspect-element', id)}
                          >inspect</wa-button
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
                  <wa-button
                    class="src-link"
                    size="small"
                    appearance="plain"
                    title="Open this file in your editor"
                    @click=${() => openInEditor(src.file, src.line)}
                    >${src.file}:${src.line}</wa-button
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-span-detail': TimelineSpanDetail;
  }
}
