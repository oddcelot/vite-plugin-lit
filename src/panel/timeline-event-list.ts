import {LitElement, html, svg, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import {virtualize, virtualizerRef} from '@lit-labs/virtualizer/virtualize.js';
import type {VirtualizerHostElement} from '@lit-labs/virtualizer/virtualize.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import {tokens} from '../lib/tokens.js';
import {waSquare} from './wa-square.js';
import type {TimelineEvent} from '../types/timeline.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
import {
  emptyStateStyles,
  layerColor,
  renderEmptyState,
} from './timeline-layers.js';
import type {LayerState} from './timeline-layers.js';
import {applyFilter, NO_FILTER, rawRow} from '../lib/timeline/model.js';
import type {TimelineFilter} from '../lib/timeline/model.js';
import {
  buildListRows,
  causeParentKey,
  foldParentKey,
  foldParentKeys,
} from '../lib/timeline/tick-rows.js';
import type {ListRow, TickAttention} from '../lib/timeline/tick-rows.js';
import {buildRails} from '../lib/timeline/cause-rails.js';
import type {RailRow} from '../lib/timeline/cause-rails.js';
import './timeline-span-detail.js';

/** How long {@link TimelineEventList.reveal} waits for the virtualizer. */
const REVEAL_TIMEOUT_MS = 5000;

/** Lit updates are routinely sub-millisecond, so one decimal is not enough. */
const formatMs = (ms: number): string =>
  ms < 1 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(1)}ms`;

const renderDuration = (row: TimelineSpan): string => {
  if (row.duration !== undefined) return formatMs(row.duration);
  // A span with a pairing id but no end is still running, or its end fell out
  // of the buffer. A point event never had one to wait for.
  return row.groupId === undefined ? '' : '…';
};

/** Width of one lane of the cause rail column, in px (and SVG units). */
const LANE = 16;
/** How many `--rail-N` colours the chains cycle through. */
const RAIL_COLORS = 6;

/** One row's rail, with the chain that owns each lane it draws in. */
interface RailCell {
  rail: RailRow;
  /** Lane to chain, for the node's lane, its fork and every through line. */
  chains: Record<number, number>;
}

const railColor = (chain: number | undefined): string =>
  `var(--rail-${(chain ?? 0) % RAIL_COLORS})`;

const FLAG_LABEL: Record<TickAttention, string> = {
  error: 'A nested row is an error',
  warning: 'A nested row is a warning',
  skipped: 'The update was skipped',
};
const FLAG_MARK: Record<TickAttention, string> = {
  error: '!',
  warning: '!',
  skipped: 'skip',
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
 * Spans of one update tick are grouped further: the list shows the tick's
 * `performUpdate` row, collapsed, and a disclosure button reveals the phases
 * and same-tick events nested under it (`buildListRows` owns what nests). The
 * expanded set lives here rather than in `TimelineModel` because only this
 * list has rows to open; selecting a nested span, from anywhere, opens its
 * tick so the row can be shown.
 *
 * Update ticks with a recorded cause stay in time order; a rail column on
 * the left draws a line from each one to the row that caused it, across the
 * rows in between, the way `git log --graph` draws branches
 * (`buildRails` owns the layout). Hovering a row of a chain fades the
 * others.
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
    waSquare,
    emptyStateStyles,
    css`
      :host {
        /* One hue per cause chain; mid lightness so each reads on both the
           light and the dark panel, and none of them is the layer blues and
           purples or the grey of the selected row. */
        --rail-0: hsl(174 72% 40%);
        --rail-1: hsl(24 88% 54%);
        --rail-2: hsl(330 72% 58%);
        --rail-3: hsl(203 82% 50%);
        --rail-4: hsl(96 52% 44%);
        --rail-5: hsl(46 92% 45%);
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
      .filterbar .count {
        margin-left: auto;
        color: var(--lit-devtools-text-muted);
      }
      .scroll {
        flex: 1;
        overflow-y: auto;
        padding: var(--lit-devtools-space-2) 0;
      }
      .row {
        /* The virtualizer positions rows absolutely; stretch them back. That
           absolute position also anchors the rail column inside the row. */
        box-sizing: border-box;
        width: 100%;
        display: flex;
        align-items: baseline;
        gap: var(--lit-devtools-space-4);
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
        /* Room for the rail column, the same on every row. */
        padding-left: calc(
          var(--lit-devtools-space-5) + var(--lane-count, 0) * 16px
        );
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
      .row > .dot {
        width: 8px;
        height: 8px;
        border-radius: 0;
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
      /* One twisty width plus the row gap: every row carries a twisty or a
         placeholder, so nested titles line up. */
      .row.nested {
        padding-left: calc(
          var(--lit-devtools-space-5) + var(--lane-count, 0) * 16px + 14px +
            var(--lit-devtools-space-4)
        );
      }
      /* Spans the row's full height (and its bottom border) so the lines of
         neighbouring rows meet. */
      .rail {
        position: absolute;
        top: 0;
        bottom: -1px;
        left: var(--lit-devtools-space-5);
        width: calc(var(--lane-count) * 16px);
        pointer-events: none;
      }
      .rail svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        fill: none;
      }
      .rail .dot {
        position: absolute;
        top: 50%;
        width: 6px;
        height: 6px;
        margin: 0;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        /* A ring in the list's background keeps a line behind it legible. */
        box-shadow: 0 0 0 2px var(--lit-devtools-bg);
      }
      .rail .off {
        opacity: 0.35;
      }
      .twisty {
        flex-shrink: 0;
        width: 14px;
        height: 14px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--lit-devtools-text-muted);
        cursor: pointer;
        align-self: center;
        position: relative;
      }
      .twisty:hover {
        color: var(--lit-devtools-text);
      }
      .twisty::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 3px;
        border: 4px solid transparent;
        border-left: 5px solid currentColor;
        border-right: 0;
      }
      .twisty[aria-expanded='true']::before {
        left: 3px;
        top: 4px;
        border: 4px solid transparent;
        border-top: 5px solid currentColor;
        border-bottom: 0;
      }
      .nest {
        flex-shrink: 0;
        color: var(--lit-devtools-text-muted);
      }
      .flag {
        flex-shrink: 0;
        color: var(--lit-devtools-warning, var(--lit-devtools-accent));
      }
      .flag.error {
        color: var(--lit-devtools-error, var(--lit-devtools-accent));
      }
      .row.warning .title,
      .row.warning .mark {
        color: var(--lit-devtools-warning, var(--lit-devtools-accent));
      }
      .row.error .title,
      .row.error .mark {
        color: var(--lit-devtools-error, var(--lit-devtools-accent));
      }
      .mark {
        flex-shrink: 0;
      }
      .expand-all {
        font: inherit;
        color: var(--lit-devtools-text-secondary);
        background: none;
        border: 0;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
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
  /** Offer a Record button in the empty state. */
  @property({type: Boolean}) canRecord = false;

  private readonly _requestRecord = () =>
    this.dispatchEvent(
      new CustomEvent('record-request', {bubbles: true, composed: true})
    );
  /** Key of the selected row. Keys survive re-derivation; the row objects
   *  themselves are rebuilt whenever the event buffer changes. */
  @property({attribute: false}) selectedKey: string | null = null;
  /** Element and regex filter. Owned by `timeline-view`, which applies the
   *  same filter to the tracks; applied here too because Raw rows are not
   *  spans the view derives. */
  @property({attribute: false}) filter: TimelineFilter = NO_FILTER;
  /** One row per raw event instead of one per collapsed span. */
  @state() private _raw = false;
  /** Keys of the ticks whose nested rows are listed. Replaced, never mutated,
   *  so Lit and the row memo see it change. */
  @state() private _expanded: ReadonlySet<string> = new Set();
  /** The cause chain of the hovered row, whose rails stay at full strength. */
  @state() private _hoverChain: number | null = null;

  private readonly _scrollRef = createRef<HTMLDivElement>();
  /** Rows for the current mode, recomputed only when the events,
   *  spans or Raw mode change — deriving in `render()` would re-pair the whole buffer
   *  on every keystroke in the regex box. */
  private _rowsCache: TimelineSpan[] = [];
  /** `_rowsCache` after the layer/element/regex filters, recomputed only when
   *  one of those or `_rowsCache` itself changes — not on every render (e.g.
   *  selecting a row must not re-filter up to `MAX_EVENTS` rows). */
  private _matchedCache: TimelineSpan[] = [];
  /** What the virtualizer lists: `_matchedCache` grouped into ticks. Also
   *  rebuilt when a tick opens or closes. */
  private _visibleCache: ListRow[] = [];
  /** `_rowsCache` after the layer toggles only. */
  private _layered: TimelineSpan[] = [];
  /** The rail of each of `_visibleCache`'s rows; empty in Raw mode. */
  private _railsCache = new Map<ListRow, RailCell>();
  /** Lanes the rail column is wide, on every row; 0 hides it. */
  private _laneCount = 0;
  /** The expanded set `_visibleCache` was built with. */
  private _rowsExpanded: ReadonlySet<string> = this._expanded;

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('events') || changed.has('spans') || changed.has('_raw')) {
      // A selection that is not among these rows (a span key in Raw mode, or
      // one that fell out of the buffer) just shows as unselected here;
      // `timeline-view` owns clearing it.
      this._rowsCache = this._raw ? this.events.map(rawRow) : this.spans;
    }
    // Selecting a nested span, from the tracks, a link or the range summary,
    // opens its tick so there is a row to select. Only on a change of
    // selection, so the reader can close the tick again afterwards.
    let expanded = this._expanded;
    if (changed.has('selectedKey') && !this._raw && this.selectedKey !== null) {
      const span = this._rowsCache.find((row) => row.key === this.selectedKey);
      const parent = span ? foldParentKey(span, this._rowsCache) : undefined;
      if (parent !== undefined && !expanded.has(parent)) {
        expanded = new Set([...expanded, parent]);
        this._expanded = expanded;
      }
    }
    const refilter =
      changed.has('events') ||
      changed.has('spans') ||
      changed.has('_raw') ||
      changed.has('layers') ||
      changed.has('filter');
    if (refilter) {
      // Compile once per relevant change, not once per render; an invalid
      // pattern disables the filter (rather than hiding everything).
      this._layered = this._rowsCache.filter((row) => this._layerOn(row));
      this._matchedCache = applyFilter(this._layered, this.filter);
    }
    if (refilter || expanded !== this._rowsExpanded) {
      this._rowsExpanded = expanded;
      // Raw rows have no ticks to group.
      this._visibleCache = this._raw
        ? this._matchedCache.map((span) => ({span, depth: 0}))
        : buildListRows(this._layered, this._matchedCache, expanded);
      this._buildRails();
    }
  }

  /**
   * Lays out `_visibleCache`'s rail column. `buildRails` does not say which
   * chain a through line belongs to, so the owner of each lane is carried
   * down the rows here: a node claims its lane for its chain.
   */
  private _buildRails() {
    this._railsCache = new Map();
    this._laneCount = 0;
    if (this._raw) {
      this.style.removeProperty('--lane-count');
      return;
    }
    const rails = buildRails(this._visibleCache);
    const laneChain: number[] = [];
    let lanes = 0;
    rails.forEach((rail, i) => {
      const chains: Record<number, number> = {};
      for (const lane of rail.through) {
        chains[lane] = laneChain[lane] ?? 0;
        lanes = Math.max(lanes, lane + 1);
      }
      if (rail.lane !== undefined && rail.chain !== undefined) {
        chains[rail.lane] = rail.chain;
        laneChain[rail.lane] = rail.chain;
        lanes = Math.max(lanes, rail.lane + 1);
        if (rail.fork !== undefined) {
          chains[rail.fork] = rail.chain;
          lanes = Math.max(lanes, rail.fork + 1);
        }
      }
      this._railsCache.set(this._visibleCache[i]!, {rail, chains});
    });
    this._laneCount = lanes;
    // On the host, not as a `style` binding on the scroller: the virtualizer
    // owns that element's inline style (position, size) and a Lit attribute
    // binding would rewrite the whole attribute under it.
    if (lanes > 0) this.style.setProperty('--lane-count', String(lanes));
    else this.style.removeProperty('--lane-count');
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
        : this._visibleCache.findIndex(
            (row) => row.span.key === this.selectedKey
          );
    if (index === -1) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // A list that has only just received its rows is not ready to scroll:
    // the virtualizer may not hold the items yet, and it throws until its
    // layout -- a separately loaded chunk, slow on a cold snapshot -- has
    // arrived. Keep trying each frame for a bounded time, not a frame count,
    // and stop if the selection moves on meanwhile.
    const key = this.selectedKey;
    const deadline = performance.now() + REVEAL_TIMEOUT_MS;
    const attempt = (): void => {
      if (!this.isConnected || this.selectedKey !== key) return;
      try {
        const target = el[virtualizerRef]?.element(index);
        if (target !== undefined) {
          target.scrollIntoView({block: 'center'});
          return;
        }
      } catch {
        // Not laid out yet.
      }
      if (performance.now() < deadline) requestAnimationFrame(attempt);
    };
    attempt();
  }

  /** Opens or closes one tick. Closing the tick of the selected phase moves
   *  the selection to the tick, which is the row left to show it. */
  private _toggle(row: ListRow, open: boolean) {
    const key = row.span.key;
    if (this._expanded.has(key) === open) return;
    const next = new Set(this._expanded);
    if (open) next.add(key);
    else next.delete(key);
    this._expanded = next;
    if (!open && this.selectedKey !== null && this.selectedKey !== key) {
      const selected = this._rowsCache.find((s) => s.key === this.selectedKey);
      if (selected && foldParentKey(selected, this._layered) === key) {
        this._select(key);
      }
    }
  }

  private _toggleAll() {
    const ticks = this._visibleCache.filter((row) => row.tick);
    const allOpen = ticks.every((row) => row.tick!.expanded);
    if (allOpen) {
      this._expanded = new Set();
      return;
    }
    this._expanded = new Set(foldParentKeys(this._layered).values());
  }

  /** Selects the row that caused `span`; nothing if it is not in the buffer. */
  private _jumpToCause(span: TimelineSpan) {
    const parent = causeParentKey(span, this._layered);
    if (parent !== undefined) this._select(parent);
  }

  /** The row that caused `span`, for the detail pane to name it. */
  private _causeOf(span: TimelineSpan): TimelineSpan | undefined {
    if (span.cause?.kind !== 'task') return undefined;
    const key = causeParentKey(span, this._layered);
    return key === undefined
      ? undefined
      : this._layered.find((s) => s.key === key);
  }

  private _layerOn(row: TimelineSpan): boolean {
    const l = this.layers.find((l) => l.id === row.layerId);
    return !l || l.enabled;
  }

  override render() {
    const visible = this._visibleCache;
    const ticks = visible.filter((row) => row.tick);
    const counts = `${this._matchedCache.length} / ${this._rowsCache.length}`;
    const selected =
      this.selectedKey === null
        ? undefined
        : this._rowsCache.find((row) => row.key === this.selectedKey);
    return html`
      ${
        this.events.length > 0
          ? html`
              <div class="filterbar">
                <wa-switch
                  class=${this._raw ? 'on' : ''}
                  size="small"
                  ?checked=${this._raw}
                  data-tip="Show one row per recorded event instead of collapsing start/end pairs"
                  @change=${() => {
                    this._raw = !this._raw;
                    // Raw and collapsed rows have different keys, so the
                    // selection cannot carry across the switch.
                    this._select(null);
                  }}
                >
                  Raw
                </wa-switch>
                ${
                  ticks.length > 0
                    ? html`<button
                        class="expand-all"
                        @click=${() => this._toggleAll()}
                      >
                        ${
                          ticks.every((row) => row.tick!.expanded)
                            ? 'Collapse all'
                            : 'Expand all'
                        }
                      </button>`
                    : nothing
                }
                <span class="count">${counts}</span>
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
                ${
                  this.events.length === 0
                    ? renderEmptyState(
                        this.canRecord ? this._requestRecord : undefined
                      )
                    : html`<div class="empty">
                        <span>No events match the filters.</span>
                      </div>`
                }
              </div>
            `
          : html`
              <div
                class="scroll"
                ${ref(this._scrollRef)}
                @mouseleave=${() => {
                  this._hoverChain = null;
                }}
              >
                ${virtualize({
                  scroller: true,
                  items: visible,
                  // The directive re-renders its previous index range against
                  // a new `items` before the virtualizer recomputes it, so the
                  // tail of that range can briefly be past the end.
                  keyFunction: (row, i) => row?.span.key ?? i,
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
              .layers=${this.layers}
              .causeSpan=${this._causeOf(selected)}
              @span-jump=${() => this._jumpToCause(selected)}
            ></timeline-span-detail>`
          : nothing
      }
    `;
  }

  /**
   * The row's slice of the rail column: straight lines for the lanes passing
   * through, the node's own lane above and below its dot, and a curve from
   * the parent's lane when the node forked. The SVG stretches to the row's
   * height; the dot is HTML so it stays round.
   */
  private _renderRail(item: ListRow) {
    const cell = this._railsCache.get(item);
    if (this._laneCount === 0 || cell === undefined) return nothing;
    const {rail, chains} = cell;
    const hover = this._hoverChain;
    const off = (chain: number | undefined) =>
      hover !== null && chain !== hover ? 'off' : '';
    const line = (lane: number, y1: number, y2: number) => {
      const x = lane * LANE + LANE / 2;
      return svg`<line
        class=${off(chains[lane])}
        x1=${x} y1=${y1} x2=${x} y2=${y2}
        style=${`stroke: ${railColor(chains[lane])}`}
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />`;
    };
    const {lane, fork, chain} = rail;
    const x = lane === undefined ? 0 : lane * LANE + LANE / 2;
    const fx = fork === undefined ? 0 : fork * LANE + LANE / 2;
    const dim = hover !== null && chain !== hover;
    return html`<span class="rail ${dim ? 'dim' : ''}" aria-hidden="true"
      ><svg
        viewBox="0 0 ${this._laneCount * LANE} ${LANE}"
        preserveAspectRatio="none"
      >
        ${rail.through.map((l) => line(l, 0, LANE))}
        ${lane !== undefined && rail.above ? line(lane, 0, LANE / 2) : nothing}
        ${
          lane !== undefined && rail.below
            ? line(lane, LANE / 2, LANE)
            : nothing
        }
        ${
          lane !== undefined && fork !== undefined
            ? svg`<path
                class=${off(chain)}
                d="M ${fx} 0 C ${fx} ${LANE / 2}, ${x} 0, ${x} ${LANE / 2}"
                style=${`stroke: ${railColor(chain)}`}
                stroke-width="1.5"
                vector-effect="non-scaling-stroke"
              />`
            : nothing
        }</svg
      >${
        lane !== undefined
          ? html`<i
              class="dot ${off(chain)}"
              style=${`left: calc(${lane * LANE}px + ${LANE / 2}px); background: ${railColor(chain)}`}
            ></i>`
          : nothing
      }</span
    >`;
  }

  /** One row of the virtualized list (`virtualize`'s `renderItem`). */
  private _renderRow(item: ListRow) {
    const {span: row, tick} = item;
    // A tick row stands for its whole update, so it shows what the phases
    // inside changed; any other row shows its own changes.
    const changed = row.changed?.length ? row.changed : tick?.changed;
    return html`
      <div
        class="row ${this.selectedKey === row.key ? 'selected' : ''} ${
          item.depth > 0 ? 'nested' : ''
        } ${row.logType === 'warning' || row.logType === 'error' ? row.logType : ''}"
        @click=${() => this._select(row.key)}
        @mouseenter=${
          this._laneCount > 0
            ? () => {
                this._hoverChain =
                  this._railsCache.get(item)?.rail.chain ?? null;
              }
            : nothing
        }
      >
        ${this._renderRail(item)}
        ${
          tick
            ? html`<button
                class="twisty"
                aria-expanded=${tick.expanded ? 'true' : 'false'}
                aria-label=${
                  (tick.expanded ? 'Collapse ' : 'Expand ') +
                  `${tick.count} nested rows of ${row.subtitle ?? row.name}`
                }
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._toggle(item, !tick.expanded);
                }}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  this._toggle(item, e.key === 'ArrowRight');
                }}
              ></button>`
            : this._raw
              ? nothing
              : html`<span class="twisty" aria-hidden="true"></span>`
        }
        <span class="time">${row.start.toFixed(1)}ms</span>
        <span
          class="dot"
          style=${'background:' + layerColor(this.layers, row.layerId)}
        ></span>
        <span class="title">${row.name}</span>
        ${
          row.logType === 'warning' || row.logType === 'error'
            ? html`<span class="mark" data-tip=${`Lit ${row.logType}`}>!</span>`
            : nothing
        }
        ${
          tick
            ? html`<span class="nest" data-tip="Nested rows"
                  >+${tick.count}</span
                >${
                  tick.attention
                    ? html`<span
                        class="flag ${tick.attention === 'error' ? 'error' : ''}"
                        title=${FLAG_LABEL[tick.attention]}
                        >${FLAG_MARK[tick.attention]}</span
                      >`
                    : nothing
                }`
            : nothing
        }
        ${
          changed?.length
            ? html`<span class="changed">${changed.join(', ')}</span>`
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
