import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import {virtualize, virtualizerRef} from '@lit-labs/virtualizer/virtualize.js';
import type {VirtualizerHostElement} from '@lit-labs/virtualizer/virtualize.js';
import {tokens} from '../lib/tokens.js';
import type {TimelineEvent} from '../types/timeline.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
import {layerColor} from './timeline-layers.js';
import type {LayerState} from './timeline-layers.js';
import {compileRegex, filterSpans} from '../lib/timeline/filter.js';
import './timeline-span-detail.js';

const RAW_KEY_PREFIX = 'raw:';

/** Whether `key` names a Raw-mode row rather than a collapsed span. */
export const isRawKey = (key: string): boolean =>
  key.startsWith(RAW_KEY_PREFIX);

/**
 * Adapts one raw event to the row shape for the Raw toggle. Deliberately
 * drops `groupId`: pairing is what the collapsed mode is for, and without it
 * the duration cell reads "point event" rather than "still open".
 */
const rawRow = (event: TimelineEvent, index: number): TimelineSpan => ({
  layerId: event.layerId,
  key: `${RAW_KEY_PREFIX}${index}`,
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
 *
 * The spans and the selection belong to `timeline-view`, which shares both
 * with the Tracks presentation: this element reads `.spans` and
 * `.selectedKey` and reports clicks as a `span-select` event. It still reads
 * `.events` for Raw mode and the element picker.
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
        /* The virtualizer positions rows absolutely; stretch them back. */
        box-sizing: border-box;
        width: 100%;
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
    `,
  ];

  @property({type: Array}) events: TimelineEvent[] = [];
  /** `toSpans(events)`, derived once by `timeline-view` for both views. */
  @property({type: Array}) spans: TimelineSpan[] = [];
  @property({type: Array}) layers: LayerState[] = [];
  /** Key of the selected row. Keys survive re-derivation; the row objects
   *  themselves are rebuilt whenever the event buffer changes. */
  @property({attribute: false}) selectedKey: string | null = null;
  /** Element id to filter the list to, or null for all elements. Owned by
   *  `timeline-view`, which applies the same filter to the tracks. */
  @property({attribute: false}) elementFilter: number | null = null;
  /** Case-insensitive regex (source text) matched against tag/title/subtitle.
   *  Owned by `timeline-view`, like `elementFilter`. */
  @property({attribute: false}) regex = '';
  /** One row per raw event instead of one per collapsed span. */
  @state() private _raw = false;

  private readonly _scrollRef = createRef<HTMLDivElement>();
  /** Rows for the current mode, recomputed only when the events,
   *  spans or Raw mode change — deriving in `render()` would re-pair the whole buffer
   *  on every keystroke in the regex box. */
  private _rowsCache: TimelineSpan[] = [];
  /** `_rowsCache` after the layer/element/regex filters, recomputed only when
   *  one of those or `_rowsCache` itself changes — not on every render (e.g.
   *  selecting a row must not re-filter up to `MAX_EVENTS` rows). */
  private _visibleCache: TimelineSpan[] = [];

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('events') || changed.has('spans') || changed.has('_raw')) {
      // A selection that is not among these rows (a span key in Raw mode, or
      // one that fell out of the buffer) just shows as unselected here;
      // `timeline-view` owns clearing it.
      this._rowsCache = this._raw ? this.events.map(rawRow) : this.spans;
    }
    if (
      changed.has('events') ||
      changed.has('spans') ||
      changed.has('_raw') ||
      changed.has('layers') ||
      changed.has('elementFilter') ||
      changed.has('regex')
    ) {
      // Compile once per relevant change, not once per render; an invalid
      // pattern disables the filter (rather than hiding everything).
      this._visibleCache = filterSpans(
        this._rowsCache.filter((row) => this._layerOn(row)),
        this.elementFilter,
        compileRegex(this.regex).re
      );
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('events')) {
      const el = this._scrollRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  private _select(key: string | null) {
    this.dispatchEvent(
      new CustomEvent<{key: string | null}>('span-select', {
        detail: {key},
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Scrolls the selected row into view, or to the newest row when nothing is
   * selected. `timeline-view` calls this when switching back from Tracks: the
   * list was hidden while the selection moved, so its own auto-scroll could
   * not follow.
   */
  reveal(): void {
    const el = this._scrollRef.value as
      | (HTMLDivElement & VirtualizerHostElement)
      | undefined;
    if (!el) return;
    const index =
      this.selectedKey === null
        ? -1
        : this._visibleCache.findIndex((row) => row.key === this.selectedKey);
    if (index === -1) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // A list that has only just received its rows has not laid out yet, and
    // the virtualizer throws until it has; wait for it a few frames.
    const attempt = (left: number): void => {
      try {
        el[virtualizerRef]?.element(index)?.scrollIntoView({block: 'center'});
      } catch {
        if (left > 0) requestAnimationFrame(() => attempt(left - 1));
      }
    };
    attempt(30);
  }

  private _layerOn(row: TimelineSpan): boolean {
    const l = this.layers.find((l) => l.id === row.layerId);
    return !l || l.enabled;
  }

  override render() {
    const visible = this._visibleCache;
    const selected =
      this.selectedKey === null
        ? undefined
        : this._rowsCache.find((row) => row.key === this.selectedKey);
    return html`
      ${
        this.events.length > 0
          ? html`
              <div class="filterbar">
                <button
                  class=${this._raw ? 'on' : ''}
                  title="Show one row per recorded event instead of collapsing start/end pairs"
                  @click=${() => {
                    this._raw = !this._raw;
                    // Raw and collapsed rows have different keys, so the
                    // selection cannot carry across the switch.
                    this._select(null);
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
      ${
        // Two separate scrollers, not one with a switched child: the
        // virtualizer owns its host's scroll height, so an empty state
        // rendered into it after Clear would sit thousands of px above view.
        visible.length === 0
          ? html`
              <div class="scroll">
                <div class="empty">
                  <span>No events recorded.</span>
                  <span class="hint"
                    >Press Record then interact with the page.</span
                  >
                </div>
              </div>
            `
          : html`
              <div class="scroll" ${ref(this._scrollRef)}>
                ${virtualize({
                  scroller: true,
                  items: visible,
                  // The directive re-renders its previous index range against
                  // a new `items` before the virtualizer recomputes it, so the
                  // tail of that range can briefly be past the end.
                  keyFunction: (row, i) => row?.key ?? i,
                  renderItem: (row) => (row ? this._renderRow(row) : html``),
                })}
              </div>
            `
      }
      ${
        selected
          ? html`<timeline-span-detail
              filterable
              .span=${selected}
            ></timeline-span-detail>`
          : nothing
      }
    `;
  }

  /** One row of the virtualized list (`virtualize`'s `renderItem`). */
  private _renderRow(row: TimelineSpan) {
    return html`
      <div
        class="row ${this.selectedKey === row.key ? 'selected' : ''}"
        @click=${() => this._select(row.key)}
      >
        <span class="time">${row.start.toFixed(1)}ms</span>
        <span
          class="dot"
          style=${'background:' + layerColor(this.layers, row.layerId)}
        ></span>
        <span class="title">${row.name}</span>
        ${
          row.changed?.length
            ? html`<span class="changed">${row.changed.join(', ')}</span>`
            : nothing
        }
        <span class="subtitle">${row.subtitle ?? nothing}</span>
        <span class="dur ${row.duration === undefined ? 'open' : ''}"
          >${renderDuration(row)}</span
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-event-list': TimelineEventList;
  }
}
