import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import {tokens} from '../lib/tokens.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
import {
  describeRange,
  fitRange,
  formatMs,
  moveEdge,
  normalizeRange,
  summarizeRange,
} from '../lib/timeline/range.js';
import type {RangeEdge, TimeRange} from '../lib/timeline/range.js';
import {
  buildTracks,
  clampPan,
  clampZoom,
  livePan,
  niceStep,
  timeBounds,
  timeScale,
  visibleRange,
  zoomAt,
} from '../lib/timeline/tracks.js';
import type {TimeScale, Track} from '../lib/timeline/tracks.js';
import {layerColor} from './timeline-layers.js';
import type {LayerState} from './timeline-layers.js';
import './timeline-span-detail.js';
import './timeline-range-summary.js';

/** Height of one packed row inside a lane. */
const ROW_PX = 14;
/** Marks narrower than this draw as a fixed-width tick, so sub-millisecond
 *  Lit phases stay visible at any zoom. */
const MIN_MARK_PX = 2;
/** Rough spacing between axis labels. */
const TICK_PX = 90;
/** Shift+Arrow moves a range edge this many tick steps instead of one. */
const BIG_STEP = 5;
/** A pointer that moves less than this between down and up was a click. */
const DRAG_SLOP_PX = 3;

const formatAxis = (ms: number, step: number): string =>
  step >= 1000
    ? `${(ms / 1000).toFixed(step >= 10_000 ? 0 : 1)}s`
    : `${ms.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}ms`;

const describe = (span: TimelineSpan): string => {
  const parts = [span.name];
  if (span.subtitle) parts.push(span.subtitle);
  parts.push(`@ ${span.start.toFixed(2)}ms`);
  if (span.duration !== undefined) parts.push(`${span.duration.toFixed(3)}ms`);
  else if (span.groupId !== undefined) parts.push('still open');
  return parts.join(' · ');
};

/**
 * The Timeline's Tracks presentation: one horizontal lane per layer on a
 * shared, recording-relative time axis, so concurrency and rhythm are
 * visible — which layers fire together, how a click lines up with the update
 * tick it caused, how long one tick is next to its neighbours.
 *
 * The same {@link TimelineSpan}s as the list, and the same selection: a click
 * on a mark emits `span-select`, and `timeline-view` passes the key back to
 * both presentations. `spans` arrive already narrowed by the view's element
 * and regex filters; `selectedSpan` does not, so the detail outlives a filter
 * that hides the selected mark. `visibleTracks` is a panel-local view filter, not the
 * capture toggle.
 *
 * Wheel zooms around the cursor, drag pans, double-click fits the whole
 * recording again. Shift+drag on the lanes, or a plain drag on the time
 * ruler, draws a shaded range (a click on the ruler, or Esc, clears it) and
 * the detail pane summarises it unless a span is selected; both are reported
 * as `range-change` and kept by `timeline-view`, so the list can honour it. While recording and not panned away, the view follows the
 * live edge the way the list auto-scrolls.
 *
 * DOM rather than canvas: marks are absolutely positioned elements, and only
 * the ones inside the visible window are rendered (binary search per row,
 * plus at most one tick per pixel column), which keeps node count bounded and
 * gives hover titles and keyboard focus for free.
 */
@customElement('timeline-tracks')
export class TimelineTracks extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
        --gutter: 120px;
      }
      .axis,
      .lane {
        display: flex;
      }
      .axis {
        flex-shrink: 0;
        height: 20px;
        border-bottom: 1px solid var(--lit-devtools-border);
        color: var(--lit-devtools-text-muted);
      }
      .gutter {
        flex: 0 0 var(--gutter);
        box-sizing: border-box;
        padding: 0 var(--lit-devtools-space-4);
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        overflow: hidden;
        white-space: nowrap;
        border-right: 1px solid var(--lit-devtools-border);
      }
      .ticks {
        position: relative;
        flex: 1;
        overflow: hidden;
        margin-right: var(--inset, 0px);
      }
      .tick-label {
        position: absolute;
        top: 3px;
        padding-left: var(--lit-devtools-space-2);
        border-left: 1px solid var(--lit-devtools-border-strong);
        white-space: nowrap;
      }
      .stage {
        position: relative;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }
      .axis {
        cursor: crosshair;
        user-select: none;
        touch-action: none;
      }
      .overlay {
        position: absolute;
        top: 0;
        bottom: 0;
        left: var(--gutter);
        right: var(--inset, 0px);
        overflow: hidden;
        pointer-events: none;
        z-index: 2;
      }
      .range {
        position: absolute;
        top: 0;
        bottom: 0;
        background: var(--lit-devtools-accent-ring);
        opacity: 0.18;
      }
      .range-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 5px;
        margin-left: -2px;
        cursor: ew-resize;
        pointer-events: auto;
        touch-action: none;
      }
      .range-handle::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 2px;
        border-left: 1px solid var(--lit-devtools-accent-ring);
      }
      .range-handle:hover::before,
      .range-handle:focus-visible::before {
        border-left-width: 3px;
        left: 1px;
      }
      .range-handle:focus-visible {
        outline: none;
      }
      .range-label {
        position: absolute;
        top: 22px;
        padding: 0 var(--lit-devtools-space-2);
        background: var(--lit-devtools-surface-low);
        border: 1px solid var(--lit-devtools-accent-ring);
        color: var(--lit-devtools-text);
        white-space: nowrap;
      }
      .lanes {
        flex: 1;
        overflow-y: auto;
        cursor: grab;
        user-select: none;
        touch-action: none;
      }
      .lanes.dragging {
        cursor: grabbing;
      }
      .lane {
        border-bottom: 1px solid var(--lit-devtools-border);
      }
      .lane .gutter {
        color: var(--lit-devtools-text-secondary);
        cursor: default;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 0;
        flex-shrink: 0;
      }
      .plot {
        flex: 1;
        min-width: 0;
        max-height: calc(8 * ${ROW_PX}px);
        /* Reserved even without overflow, so every lane is as wide as the
           others and the ruler can leave the same room. */
        scrollbar-gutter: stable;
        overflow-x: hidden;
        overflow-y: auto;
      }
      .rows {
        position: relative;
      }
      .mark {
        position: absolute;
        box-sizing: border-box;
        height: ${ROW_PX - 3}px;
        margin-top: 1px;
        border-radius: 0;
        opacity: 0.85;
        overflow: hidden;
        white-space: nowrap;
        color: var(--lit-devtools-surface-low);
        font-size: 9px;
        line-height: ${ROW_PX - 3}px;
        padding: 0 2px;
        cursor: pointer;
      }
      .mark.tick {
        padding: 0;
      }
      .mark.open {
        opacity: 0.45;
      }
      .mark:hover {
        opacity: 1;
      }
      .mark.selected {
        opacity: 1;
        outline: 2px solid var(--lit-devtools-text);
        outline-offset: 0;
        z-index: 1;
      }
      .mark:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
        z-index: 1;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        gap: var(--lit-devtools-space-4);
        color: var(--lit-devtools-text-muted);
        font-family: var(--lit-devtools-font-sans);
        font-size: var(--lit-devtools-text-xs);
      }
    `,
  ];

  @property({type: Array}) spans: TimelineSpan[] = [];
  @property({type: Array}) layers: LayerState[] = [];
  @property({attribute: false}) selectedKey: string | null = null;
  /**
   * The selected span, resolved by the view against the unfiltered spans so
   * a filter that hides its mark does not close its detail pane.
   */
  @property({attribute: false}) selectedSpan: TimelineSpan | undefined;
  /** Layer ids to draw a lane for, in no particular order. */
  @property({type: Array}) visibleTracks: string[] = [];
  /** Follow the live edge while this is set and the user has not panned away. */
  @property({type: Boolean}) recording = false;
  /** The drawn time range, kept by the view; null for none. */
  @property({attribute: false}) range: TimeRange | null = null;

  /** Multiple of "fit"; 1 shows the whole recording. */
  @state() private _zoom = 1;
  /** Milliseconds past the origin at the left edge of the plot. */
  @state() private _pan = 0;
  /** Pinned to the live edge. Cleared by panning or zooming away from it,
   *  restored by a double-click refit. */
  @state() private _follow = true;
  @state() private _width = 0;
  /** Room the vertical scrollbars (the lanes' and each plot's) take to the
   *  right of the marks. The ruler and the range overlay leave it too, so
   *  they share one plot width with the marks. */
  @state() private _inset = 0;

  private readonly _ticksRef = createRef<HTMLDivElement>();
  private readonly _lanesRef = createRef<HTMLDivElement>();
  private _resize: ResizeObserver | null = null;
  private _observed: Element | null = null;
  private _tracks: Track[] = [];
  private _visibleSpans: TimelineSpan[] = [];
  private _bounds = {origin: 0, extent: 0};
  private _drag: {x: number; pan: number; moved: boolean} | null = null;
  /** A range being drawn: the fixed end, and the range so far. */
  @state() private _draft: {anchor: number; range: TimeRange | null} | null =
    null;
  private _summary: ReturnType<typeof summarizeRange> | undefined;
  /** The range edge being dragged by its handle. */
  private _edgeDrag: RangeEdge | null = null;
  private _edgeMoved = false;
  /** Set when a drag ends, so the click the browser fires after it does
   *  not also select whatever mark the pointer happened to finish on. */
  private _suppressClick = false;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** Whether the tracks are on screen: not in List mode, nor behind another
   *  tab (the shell keeps hidden tabs mounted). */
  private _shown(): boolean {
    if (this.hidden) return false;
    if (this.checkVisibility) return this.checkVisibility();
    return this.offsetParent !== null || this.getClientRects().length > 0;
  }

  /**
   * Esc clears the range from anywhere in the panel, except where it already
   * means something else: while typing (a Web Awesome input is found through
   * the composed path), when something handled it first, or when the tracks
   * are not showing.
   */
  private readonly _onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !this._shown()) return;
    const typing = e
      .composedPath()
      .some(
        (t) =>
          t instanceof HTMLElement &&
          (t.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT', 'WA-INPUT', 'WA-TEXTAREA'].includes(
              t.tagName
            ))
      );
    if (typing) return;
    if (this._draft !== null) {
      this._draft = null;
    } else if (this.range !== null) {
      this._emitRange(null);
    }
  };

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
    this._resize?.disconnect();
    this._resize = null;
    this._observed = null;
  }

  override updated() {
    const lanes = this._lanesRef.value;
    const plot = lanes?.querySelector<HTMLElement>('.plot');
    const inset =
      lanes && plot
        ? lanes.offsetWidth -
          lanes.clientWidth +
          (plot.offsetWidth - plot.clientWidth)
        : 0;
    if (inset !== this._inset) this._inset = inset;
    // The plot's width drives the scale. Its ticks row is re-created when the
    // view goes empty and back, so re-point the observer when it changes.
    const el = this._ticksRef.value ?? null;
    if (el === this._observed) return;
    this._resize?.disconnect();
    this._observed = el;
    if (!el) return;
    this._resize ??= new ResizeObserver(() => {
      this._width = this._observed?.clientWidth ?? 0;
    });
    this._resize.observe(el);
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (
      changed.has('spans') ||
      changed.has('layers') ||
      changed.has('visibleTracks')
    ) {
      const shown = new Set(this.visibleTracks);
      this._visibleSpans = this.spans.filter((s) => shown.has(s.layerId));
      this._tracks = buildTracks(this._visibleSpans, this.layers).filter((t) =>
        shown.has(t.layerId)
      );
      this._bounds = timeBounds(this._visibleSpans);
    }
    if (
      changed.has('range') ||
      changed.has('spans') ||
      changed.has('visibleTracks')
    ) {
      this._summary =
        this.range === null
          ? undefined
          : summarizeRange(this._visibleSpans, this.range);
    }
  }

  private _scale(): TimeScale {
    const {origin, extent} = this._bounds;
    const pan =
      this._follow && this.recording ? livePan(extent, this._zoom) : this._pan;
    return timeScale(origin, extent, this._width, this._zoom, pan);
  }

  /** Commit a zoom/pan, and keep following only if it still ends at the live
   *  edge. */
  private _setView(zoom: number, pan: number) {
    const {extent} = this._bounds;
    this._zoom = clampZoom(zoom);
    this._pan = clampPan(pan, extent, this._zoom);
    this._follow = this._pan >= livePan(extent, this._zoom) - 1e-9;
  }

  private _currentPan(): number {
    return this._scale().start - this._bounds.origin;
  }

  private _onWheel(e: WheelEvent) {
    if (this._width === 0 || this._visibleSpans.length === 0) return;
    const plot = this._ticksRef.value;
    if (!plot) return;
    const x = e.clientX - plot.getBoundingClientRect().left;
    if (x < 0) return; // over the gutter: let the lanes scroll
    e.preventDefault();
    const {origin, extent} = this._bounds;
    const pan = this._currentPan();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      // Horizontal scroll pans.
      const delta = e.shiftKey ? e.deltaY : e.deltaX;
      const scale = this._scale();
      this._setView(this._zoom, pan + delta / scale.pxPerMs);
      return;
    }
    const factor = Math.exp(-e.deltaY * 0.002);
    const next = zoomAt(
      origin,
      extent,
      this._width,
      this._zoom,
      pan,
      x,
      factor
    );
    this._setView(next.zoom, next.pan);
  }

  /** Recording time under a pointer event, or null over the gutter. */
  private _msAt(e: PointerEvent): number | null {
    const plot = this._ticksRef.value;
    if (!plot || this._width === 0) return null;
    const x = e.clientX - plot.getBoundingClientRect().left;
    return x < 0 ? null : this._scale().toMs(x);
  }

  /** Starts a range at the pointer. The view stops following the live edge,
   *  or the range would slide away under the pointer. */
  private _beginRange(e: PointerEvent): boolean {
    const ms = this._msAt(e);
    if (ms === null || this._visibleSpans.length === 0) return false;
    this._pan = this._currentPan();
    this._follow = false;
    this._draft = {anchor: ms, range: null};
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    return true;
  }

  private _emitRange(range: TimeRange | null) {
    this.dispatchEvent(
      new CustomEvent<{range: TimeRange | null}>('range-change', {
        detail: {range},
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Shift+drag on the lanes; a plain drag there pans. */
  private _onLanesDown(e: PointerEvent) {
    if (e.button === 0 && e.shiftKey && this._beginRange(e)) return;
    this._onPointerDown(e);
  }

  private _onRangeMove(e: PointerEvent) {
    const draft = this._draft;
    const ms = this._msAt(e);
    if (draft && ms !== null) {
      this._draft = {...draft, range: normalizeRange(draft.anchor, ms)};
    } else if (!draft) {
      this._onPointerMove(e);
    }
  }

  private _onRangeUp() {
    const draft = this._draft;
    if (draft) {
      this._draft = null;
      this._suppressClick = true;
      setTimeout(() => (this._suppressClick = false));
      // A click on the ruler, with no drag, clears the range.
      this._emitRange(draft.range);
    } else {
      this._onPointerUp();
    }
  }

  /** Moves one edge of the range to `ms`, within the recording, and returns
   *  where it ended up. */
  private _moveEdge(edge: RangeEdge, ms: number): number {
    const {range} = this;
    if (range === null) return ms;
    const {origin, extent} = this._bounds;
    const next = moveEdge(
      range,
      edge,
      ms,
      {min: origin, max: origin + extent},
      1 / this._scale().pxPerMs
    );
    if (next.start !== range.start || next.end !== range.end) {
      this._emitRange(next);
    }
    return next[edge];
  }

  /** Pans just far enough to bring `ms` back on screen, so a handle moved
   *  with the keys is never left behind the edge of the plot. */
  private _reveal(ms: number) {
    const scale = this._scale();
    const x = scale.toX(ms);
    if (x >= 0 && x <= this._width) return;
    const over = x < 0 ? x : x - this._width;
    this._setView(this._zoom, this._currentPan() + over / scale.pxPerMs);
  }

  /** Left and Right move the focused edge one tick step, Shift five. */
  private _onHandleKey(e: KeyboardEvent, edge: RangeEdge) {
    const {range} = this;
    if (range === null || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) {
      return;
    }
    e.preventDefault();
    const step =
      niceStep(TICK_PX / this._scale().pxPerMs) * (e.shiftKey ? BIG_STEP : 1);
    const ms = range[edge] + (e.key === 'ArrowLeft' ? -step : step);
    this._reveal(this._moveEdge(edge, ms));
  }

  private _onHandleDown(e: PointerEvent, edge: RangeEdge) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    this._edgeDrag = edge;
    this._edgeMoved = false;
  }

  private _onHandleMove(e: PointerEvent) {
    const plot = this._ticksRef.value;
    if (this._edgeDrag === null || !plot) return;
    const x = e.clientX - plot.getBoundingClientRect().left;
    this._edgeMoved = true;
    this._moveEdge(this._edgeDrag, this._scale().toMs(x));
  }

  /** A click on a handle that never moved it falls through to the mark under
   *  it, so an edge sitting on a mark does not make the mark unclickable. */
  private _onHandleUp = (e: PointerEvent) => {
    const moved = this._edgeMoved;
    this._edgeDrag = null;
    this._edgeMoved = false;
    if (moved) return;
    const under = this.shadowRoot
      ?.elementsFromPoint(e.clientX, e.clientY)
      .find((el) => el.classList.contains('mark'));
    (under as HTMLElement | undefined)?.click();
  };

  /** Fits the view to the range, leaving the live edge. Also the summary's
   *  **Zoom to range**, and what the view does when a link names a range. */
  zoomToRange = () => {
    const {range} = this;
    if (range === null) return;
    const {origin, extent} = this._bounds;
    const fit = fitRange(origin, extent, range);
    this._setView(fit.zoom, fit.pan);
    this._follow = false;
  };

  private _onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this._drag = {x: e.clientX, pan: this._currentPan(), moved: false};
  }

  private _onPointerMove(e: PointerEvent) {
    const drag = this._drag;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < DRAG_SLOP_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      this.requestUpdate();
    }
    this._setView(this._zoom, drag.pan - dx / this._scale().pxPerMs);
  }

  private _onPointerUp() {
    if (this._drag?.moved) {
      this._suppressClick = true;
      setTimeout(() => (this._suppressClick = false));
      this.requestUpdate();
    }
    this._drag = null;
  }

  private _refit() {
    this._zoom = 1;
    this._pan = 0;
    this._follow = true;
  }

  private _select(key: string) {
    if (this._suppressClick) return;
    this.dispatchEvent(
      new CustomEvent<{key: string | null}>('span-select', {
        detail: {key},
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    const selected = this.selectedSpan;
    const detail = selected
      ? html`<timeline-span-detail
          filterable
          .span=${selected}
        ></timeline-span-detail>`
      : html`<timeline-range-summary
          .summary=${this._summary}
          .layers=${this.layers}
          @range-zoom=${this.zoomToRange}
          @range-clear=${() => this._emitRange(null)}
        ></timeline-range-summary>`;
    if (this._tracks.length === 0) {
      return html`<div class="empty">
          ${
            this.visibleTracks.length === 0
              ? 'No tracks shown. Pick some above.'
              : 'No events recorded.'
          }
        </div>
        ${detail}`;
    }
    const scale = this._scale();
    return html`
      <div class="stage" style="--inset:${this._inset}px">
        <div
          class="axis"
          data-tip="Drag to select a time range"
          @pointerdown=${(e: PointerEvent) => {
            if (e.button === 0) this._beginRange(e);
          }}
          @pointermove=${this._onRangeMove}
          @pointerup=${this._onRangeUp}
          @pointercancel=${this._onRangeUp}
        >
          <div class="gutter"></div>
          <div class="ticks" ${ref(this._ticksRef)}>
            ${this._width > 0 ? this._renderTicks(scale) : nothing}
          </div>
        </div>
        <div
          ${ref(this._lanesRef)}
          class="lanes ${this._drag?.moved ? 'dragging' : ''}"
          data-tip="Wheel to zoom, drag to pan, Shift+drag to select a range, double-click to fit"
          @wheel=${this._onWheel}
          @pointerdown=${this._onLanesDown}
          @pointermove=${this._onRangeMove}
          @pointerup=${this._onRangeUp}
          @pointercancel=${this._onRangeUp}
          @dblclick=${this._refit}
        >
          ${this._tracks.map((track) => this._renderLane(track, scale))}
        </div>
        ${this._renderRange(scale)}
      </div>
      ${detail}
    `;
  }

  /** The shaded range, and while it is being drawn its bounds. */
  private _renderRange(scale: TimeScale) {
    const range = this._draft ? this._draft.range : this.range;
    if (range === null || this._width === 0) return nothing;
    const x0 = scale.toX(range.start);
    const x1 = scale.toX(range.end);
    const left = Math.max(x0, 0);
    const width = Math.min(x1, this._width) - left;
    if (width < 0) return nothing;
    const {origin, extent} = this._bounds;
    // While drawing, the edges are just lines; afterwards they are handles.
    const handle = (edge: RangeEdge, x: number) => {
      if (x < 0 || x > this._width) return nothing;
      if (this._draft) {
        return html`<div class="range-handle" style="left:${x}px"></div>`;
      }
      const ms = range[edge];
      // Each edge may travel from the recording's start to the other edge
      // (and from it to the recording's end).
      const [min, max] =
        edge === 'start' ? [origin, range.end] : [range.start, origin + extent];
      return html`<div
        class="range-handle"
        role="slider"
        tabindex="0"
        aria-label=${edge === 'start' ? 'Range start' : 'Range end'}
        aria-orientation="horizontal"
        aria-valuemin=${min}
        aria-valuemax=${max}
        aria-valuenow=${ms}
        aria-valuetext=${formatMs(ms)}
        style="left:${x}px"
        @keydown=${(e: KeyboardEvent) => this._onHandleKey(e, edge)}
        @pointerdown=${(e: PointerEvent) => this._onHandleDown(e, edge)}
        @pointermove=${this._onHandleMove}
        @pointerup=${this._onHandleUp}
        @pointercancel=${() => (this._edgeDrag = null)}
      ></div>`;
    };
    return html`<div class="overlay" role="group" aria-label="Selected range">
      <div class="range" style="left:${left}px;width:${width}px"></div>
      ${handle('start', x0)} ${handle('end', x1)}
      ${
        this._draft
          ? html`<div class="range-label" style="left:${left + 4}px">
              ${describeRange(range)}
            </div>`
          : nothing
      }
    </div>`;
  }

  private _renderTicks(scale: TimeScale) {
    const step = niceStep(TICK_PX / scale.pxPerMs);
    const labels = [];
    for (
      let t = Math.ceil(scale.start / step) * step;
      t <= scale.end && labels.length < 200;
      t += step
    ) {
      labels.push(
        html`<span class="tick-label" style="left:${scale.toX(t)}px"
          >${formatAxis(t, step)}</span
        >`
      );
    }
    return labels;
  }

  private _renderLane(track: Track, scale: TimeScale) {
    const layer = this.layers.find((l) => l.id === track.layerId);
    const color = layerColor(this.layers, track.layerId);
    const rows = Math.max(track.rows.length, 1);
    return html`
      <div class="lane">
        <div class="gutter" title=${layer?.label ?? track.layerId}>
          <span class="dot" style="background:${color}"></span>
          ${layer?.label ?? track.layerId}
        </div>
        <div class="plot">
          <div class="rows" style="height:${rows * ROW_PX}px">
            ${
              this._width > 0
                ? track.rows.map((row, i) =>
                    this._renderRow(row, i, scale, color)
                  )
                : nothing
            }
          </div>
        </div>
      </div>
    `;
  }

  private _renderRow(
    row: TimelineSpan[],
    rowIndex: number,
    scale: TimeScale,
    color: string
  ) {
    const [from, to] = visibleRange(row, scale.start, scale.end);
    const liveEdge = this._bounds.origin + this._bounds.extent;
    const marks = [];
    // At fit zoom thousands of sub-ms ticks share a handful of pixels; draw
    // one per pixel column (never dropping the selected one).
    let lastTickPx = -Infinity;
    for (let i = from; i < to; i++) {
      const span = row[i]!;
      const open = span.end === undefined && span.groupId !== undefined;
      const x0 = scale.toX(span.start);
      const x1 = scale.toX(span.end ?? (open ? liveEdge : span.start));
      const isTick = x1 - x0 < MIN_MARK_PX;
      const selected = span.key === this.selectedKey;
      if (isTick && !selected && Math.round(x0) === lastTickPx) continue;
      if (isTick) lastTickPx = Math.round(x0);
      // Clip to the plot so a long span panned half out of view still
      // shows its label at the left edge.
      const left = Math.max(x0, -1);
      const width = isTick ? MIN_MARK_PX : Math.min(x1, this._width + 1) - left;
      marks.push(html`<div
        class="mark ${isTick ? 'tick' : ''} ${open ? 'open' : ''} ${
          selected ? 'selected' : ''
        }"
        role="button"
        tabindex="0"
        title=${describe(span)}
        style="left:${left}px;width:${width}px;top:${rowIndex * ROW_PX}px;background:${color}"
        @click=${() => this._select(span.key)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' && e.shiftKey && span.end !== undefined) {
            // The keyboard way to a range: this span's own extent.
            e.preventDefault();
            this._emitRange(normalizeRange(span.start, span.end));
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._select(span.key);
          }
        }}
      >
        ${isTick || width < 40 ? nothing : span.name}
      </div>`);
    }
    return marks;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-tracks': TimelineTracks;
  }
}
