import {LitElement, html, css, nothing} from 'lit';
import type {TemplateResult} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import './wa-icons.js';
import {tokens} from '../lib/tokens.js';
import {formatMs} from '../lib/timeline/range.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
import {canOpenInEditor, openInEditor} from './open-in-editor.js';
import {sourceOpenerFor} from './source-opener.js';
import {layerColor} from './timeline-layers.js';
import type {LayerState} from './timeline-layers.js';

/** localStorage key remembering the pane's height in pixels. */
const HEIGHT_LS_KEY = 'lit-devtools-timeline-detail-height';
const HEIGHT_DEFAULT = 200;
const HEIGHT_MIN = 64;
/** Room the pane leaves above it for the list or the lanes. */
const ROOM_ABOVE = 80;
/** How far one arrow key press on the handle moves it. */
const KEY_STEP = 16;

const savedHeight = (): number => {
  try {
    const n = Number(localStorage.getItem(HEIGHT_LS_KEY));
    return Number.isFinite(n) && n >= HEIGHT_MIN ? n : HEIGHT_DEFAULT;
  } catch {
    return HEIGHT_DEFAULT;
  }
};

/**
 * Detail pane for one selected timeline span: a header naming it (layer,
 * name, time, duration), then what is known about it -- element, source,
 * cause, changed properties and values, error and raw data.
 *
 * Shared by the List and Tracks presentations of the Timeline so a selection
 * reads the same in both. Dragging the handle on its top edge (or the arrow
 * keys on it) resizes the pane; the height is remembered, and a double-click
 * restores the default. The **filter** link only makes sense where there is
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
        display: flex;
        flex-direction: column;
        position: relative;
        flex-shrink: 0;
        height: var(--detail-height, ${HEIGHT_DEFAULT}px);
        min-height: ${HEIGHT_MIN}px;
        border-top: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
        color: var(--lit-devtools-text-secondary);
      }
      .handle {
        position: absolute;
        inset: -4px 0 auto;
        height: 7px;
        cursor: ns-resize;
        z-index: 1;
        touch-action: none;
      }
      .handle:hover,
      .handle:focus-visible,
      .handle.dragging {
        outline: none;
        background: linear-gradient(
          transparent 3px,
          var(--lit-devtools-accent) 3px,
          var(--lit-devtools-accent) 5px,
          transparent 5px
        );
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-4);
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface);
        flex-shrink: 0;
        min-width: 0;
      }
      .swatch {
        width: 8px;
        height: 8px;
        flex-shrink: 0;
      }
      .name {
        color: var(--lit-devtools-text);
        font-size: var(--lit-devtools-text-xs);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .layer {
        color: var(--lit-devtools-text-muted);
        white-space: nowrap;
      }
      .timing {
        margin-left: auto;
        display: flex;
        gap: var(--lit-devtools-space-5);
        white-space: nowrap;
        color: var(--lit-devtools-text-muted);
      }
      .timing b {
        font-weight: normal;
        color: var(--lit-devtools-text);
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: var(--lit-devtools-space-4) var(--lit-devtools-space-5);
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        column-gap: var(--lit-devtools-space-6);
        row-gap: var(--lit-devtools-space-3);
        align-content: start;
        align-items: baseline;
      }
      .key {
        color: var(--lit-devtools-text-muted);
        white-space: nowrap;
      }
      .val {
        color: var(--lit-devtools-text);
        overflow-wrap: anywhere;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: var(--lit-devtools-space-4);
        row-gap: var(--lit-devtools-space-1);
      }
      .tag {
        color: var(--lit-devtools-code-tag);
      }
      .id {
        color: var(--lit-devtools-text-muted);
      }
      .actions {
        display: inline-flex;
        gap: var(--lit-devtools-space-2);
      }
      wa-button::part(base) {
        height: auto;
        min-height: 0;
        padding: 0 var(--lit-devtools-space-2);
        font: inherit;
        line-height: 1.5;
        color: var(--lit-devtools-accent);
      }
      wa-button.src-link::part(base) {
        padding: 0;
      }
      .chip {
        padding: 0 var(--lit-devtools-space-2);
        background: var(--lit-devtools-surface-container-high);
        color: var(--lit-devtools-text);
      }
      .values {
        display: grid;
        grid-template-columns: max-content auto auto auto 1fr;
        column-gap: var(--lit-devtools-space-4);
        row-gap: var(--lit-devtools-space-1);
        align-items: baseline;
      }
      .values .prev {
        color: var(--lit-devtools-text-muted);
      }
      .arrow {
        color: var(--lit-devtools-text-muted);
        vertical-align: text-bottom;
      }
      .error {
        color: var(--lit-devtools-error);
      }
      .warning {
        display: grid;
        gap: var(--lit-devtools-space-1);
        color: var(--lit-devtools-warning);
      }
      .warning .code {
        font-family: var(--lit-devtools-font-mono);
        font-size: var(--lit-devtools-text-2xs);
        color: inherit;
      }
      .warning .note {
        color: var(--lit-devtools-text-muted);
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
        color: var(--lit-devtools-text);
      }
    `,
  ];

  @property({attribute: false}) span: TimelineSpan | undefined;
  /**
   * The row `span.cause` names, when the presentation can resolve it; names a
   * `task` cause's task. Without it a task cause reads "task run".
   */
  @property({attribute: false}) causeSpan: TimelineSpan | undefined;
  /** The Timeline's layers, for the header's colour and label. */
  @property({type: Array}) layers: LayerState[] = [];
  /** Offer the **filter** link (both presentations honour the element filter). */
  @property({type: Boolean}) filterable = false;

  /** Whether `source` opens in the editor; plain text otherwise. */
  @state() private _canOpen = false;
  @state() private _height = savedHeight();
  /** Pointer and height a drag of the handle started from. */
  @state() private _drag: {y: number; height: number} | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void canOpenInEditor().then((can) => {
      this._canOpen = can;
    });
  }

  override willUpdate() {
    this.style.setProperty('--detail-height', `${this._height}px`);
  }

  /** Tallest the pane may get without hiding what it details. */
  private _maxHeight(): number {
    const root = this.getRootNode();
    const host =
      root instanceof ShadowRoot ? (root.host as HTMLElement) : undefined;
    const room = host?.clientHeight || window.innerHeight;
    return Math.max(HEIGHT_MIN, room - ROOM_ABOVE);
  }

  private _setHeight(height: number, save: boolean) {
    this._height = Math.round(
      Math.min(this._maxHeight(), Math.max(HEIGHT_MIN, height))
    );
    if (!save) return;
    try {
      localStorage.setItem(HEIGHT_LS_KEY, String(this._height));
    } catch {
      // Storage can be unavailable (sandboxed frames); the height still holds.
    }
  }

  private _onHandleDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this._drag = {y: e.clientY, height: this._height};
  }

  private _onHandleMove(e: PointerEvent) {
    if (!this._drag) return;
    this._setHeight(this._drag.height + this._drag.y - e.clientY, false);
  }

  private _onHandleUp() {
    if (!this._drag) return;
    this._drag = null;
    this._setHeight(this._height, true);
  }

  private _onHandleKey(e: KeyboardEvent) {
    const step =
      e.key === 'ArrowUp' ? KEY_STEP : e.key === 'ArrowDown' ? -KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    this._setHeight(this._height + step, true);
  }

  private _emit(type: 'element-filter' | 'inspect-element', id: number) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: {id},
        bubbles: true,
        composed: true,
      })
    );
  }

  private _jump(cause: NonNullable<TimelineSpan['cause']>) {
    this.dispatchEvent(
      new CustomEvent('span-jump', {
        detail: {cause},
        bubbles: true,
        composed: true,
      })
    );
  }

  private _causeText(cause: NonNullable<TimelineSpan['cause']>): string {
    if (cause.kind === 'update') return `update ${cause.groupId}`;
    if (cause.kind === 'task') {
      const task = (
        this.causeSpan?.events[0]?.data as {task?: unknown} | null | undefined
      )?.task;
      return typeof task === 'string' ? `${task} task run` : 'task run';
    }
    return `${cause.title ?? `${cause.layerId} event`} at ${cause.time.toFixed(3)} ms`;
  }

  private _fact(key: string, value: unknown) {
    return html`<div class="key">${key}</div>
      <div class="val" data-key=${key}>${value}</div>`;
  }

  private _fileLink(
    file: {file: string; line: number; column?: number; url?: string},
    tip: string,
    extraClass = ''
  ) {
    const text = `${file.file}:${file.line}`;
    // Resolved through the page's sourcemaps: DevTools has it, no editor does.
    const opener = sourceOpenerFor(file, this._canOpen);
    if (opener === undefined && !this._canOpen) return text;
    return html`<wa-button
      class="src-link ${extraClass}"
      size="small"
      appearance="plain"
      data-tip=${opener === undefined ? tip : 'Open in Sources'}
      @click=${() => {
        if (opener !== undefined) void opener(file);
        else if (file.column === undefined) {
          void openInEditor(file.file, file.line);
        } else void openInEditor(file.file, file.line, file.column);
      }}
      >${text}</wa-button
    >`;
  }

  private _action(text: string, tip: string, onClick: () => void) {
    return html`<wa-button
      size="small"
      appearance="plain"
      data-tip=${tip}
      @click=${onClick}
      >${text}</wa-button
    >`;
  }

  /** Reads the Lit warning off `data` defensively — it is `unknown` on the wire. */
  private _warningOf(row: TimelineSpan) {
    if (row.logType !== 'warning') return undefined;
    const data = row.events[0]?.data;
    if (data === null || typeof data !== 'object') return undefined;
    const {code, message, replayed} = data as Record<string, unknown>;
    return {
      code: typeof code === 'string' ? code : '',
      message: typeof message === 'string' ? message : '',
      replayed: replayed === true,
    };
  }

  private _renderWarning(w: {
    code: string;
    message: string;
    replayed: boolean;
  }): TemplateResult {
    return html`<div class="warning">
      ${
        w.code === ''
          ? nothing
          : html`<a
              class="code"
              href=${`https://lit.dev/msg/${w.code}`}
              target="_blank"
              rel="noreferrer"
              >${w.code}</a
            >`
      }
      <span class="text">${w.message}</span>
      ${
        w.replayed
          ? html`<span class="note">Issued before this recording started</span>`
          : nothing
      }
    </div>`;
  }

  private _renderValues(row: TimelineSpan): TemplateResult {
    return html`<div class="values">
      ${row.changedDetail!.map(
        (c) => html`<span class="vkey">${c.key}</span>
          <span class="prev">${c.prev}</span>
          <wa-icon class="arrow" name="arrow-right"></wa-icon>
          <span class="next">${c.next}</span>
          <span
            >${
              c.sameRef
                ? html`<wa-badge variant="neutral" appearance="filled"
                    >same reference</wa-badge
                  >`
                : c.equal
                  ? html`<wa-badge variant="neutral" appearance="filled"
                      >new reference, same value</wa-badge
                    >`
                  : nothing
            }</span
          >`
      )}
    </div>`;
  }

  override render() {
    const row = this.span;
    if (!row) return nothing;
    const {meta} = row;
    const src = meta?.source;
    const site = meta?.callSite;
    // Raw rows carry exactly one event; a collapsed span carries its start and
    // (once it closes) its end, whose payloads are the same minus `changed`.
    const data = row.events[0]?.data;
    const warning = this._warningOf(row);
    const id = meta?.elementId;
    const label =
      this.layers.find((l) => l.id === row.layerId)?.label ?? row.layerId;
    return html`
      <div
        class="handle ${this._drag ? 'dragging' : ''}"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize details"
        aria-valuenow=${this._height}
        tabindex="0"
        data-tip="Drag to resize, double-click to reset"
        @pointerdown=${this._onHandleDown}
        @pointermove=${this._onHandleMove}
        @pointerup=${this._onHandleUp}
        @pointercancel=${this._onHandleUp}
        @keydown=${this._onHandleKey}
        @dblclick=${() => this._setHeight(HEIGHT_DEFAULT, true)}
      ></div>
      <header>
        <span
          class="swatch"
          style=${'background:' + layerColor(this.layers, row.layerId)}
        ></span>
        <span class="name">${row.name}</span>
        <span class="layer">${label}</span>
        <span class="timing">
          <span class="time">at <b>${row.start.toFixed(3)} ms</b></span>
          ${
            row.duration !== undefined
              ? html`<span
                  class="duration"
                  title=${`${row.duration.toFixed(3)} ms`}
                  >took <b>${formatMs(row.duration)}</b></span
                >`
              : nothing
          }
        </span>
      </header>
      <div class="body">
        ${
          meta?.tagName
            ? this._fact(
                'element',
                html`<span
                    ><span class="tag">&lt;${meta.tagName}&gt;</span>${
                      id != null
                        ? html` <span class="id">#${id}</span>`
                        : nothing
                    }</span
                  >${
                    id != null
                      ? html`<span class="actions"
                          >${
                            this.filterable
                              ? this._action(
                                  'filter',
                                  'Show only events from this element',
                                  () => this._emit('element-filter', id)
                                )
                              : nothing
                          }${this._action(
                            'inspect',
                            'Open this element in the Components tab',
                            () => this._emit('inspect-element', id)
                          )}</span
                        >`
                      : nothing
                  }`
              )
            : nothing
        }
        ${src ? this._fact('source', this._fileLink(src, 'Open this file in your editor')) : nothing}
        ${
          site
            ? this._fact(
                'rendered at',
                this._fileLink(
                  site,
                  'Open the template that renders this element',
                  'call-site'
                )
              )
            : nothing
        }
        ${
          row.cause
            ? this._fact(
                'caused by',
                html`<span>${this._causeText(row.cause)}</span>${this._action(
                    'show',
                    'Select the row that caused this update',
                    () => this._jump(row.cause!)
                  )}`
              )
            : nothing
        }
        ${
          row.changed?.length
            ? this._fact(
                'changed',
                row.changed.map((key) => html`<span class="chip">${key}</span>`)
              )
            : nothing
        }
        ${row.changedDetail?.length ? this._fact('values', this._renderValues(row)) : nothing}
        ${
          row.error
            ? this._fact(
                'error',
                html`<span class="error"
                  >${row.error.name}:
                  ${row.error.message}${
                    row.error.task
                      ? ` (task ${row.error.task})`
                      : row.error.async
                        ? ' (async)'
                        : ''
                  }</span
                >`
              )
            : nothing
        }
        ${warning ? this._fact('warning', this._renderWarning(warning)) : nothing}
        ${
          data != null
            ? this._fact(
                'data',
                html`<pre>${JSON.stringify(data, null, 2)}</pre>`
              )
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-span-detail': TimelineSpanDetail;
  }
}
