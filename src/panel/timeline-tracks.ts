import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import {tokens} from '../lib/tokens.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
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

/** Height of one packed row inside a lane. */
const ROW_PX = 14;
/** Marks narrower than this draw as a fixed-width tick, so sub-millisecond
 *  Lit phases stay visible at any zoom. */
const MIN_MARK_PX = 2;
/** Rough spacing between axis labels. */
const TICK_PX = 90;
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
 * recording again. While recording and not panned away, the view follows the
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
      }
      .tick-label {
        position: absolute;
        top: 3px;
        padding-left: var(--lit-devtools-space-2);
        border-left: 1px solid var(--lit-devtools-border-strong);
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

  /** Multiple of "fit"; 1 shows the whole recording. */
  @state() private _zoom = 1;
  /** Milliseconds past the origin at the left edge of the plot. */
  @state() private _pan = 0;
  /** Pinned to the live edge. Cleared by panning or zooming away from it,
   *  restored by a double-click refit. */
  @state() private _follow = true;
  @state() private _width = 0;

  private readonly _ticksRef = createRef<HTMLDivElement>();
  private _resize: ResizeObserver | null = null;
  private _observed: Element | null = null;
  private _tracks: Track[] = [];
  private _visibleSpans: TimelineSpan[] = [];
  private _bounds = {origin: 0, extent: 0};
  private _drag: {x: number; pan: number; moved: boolean} | null = null;
  /** Set when a drag ends, so the click the browser fires after it does
   *  not also select whatever mark the pointer happened to finish on. */
  private _suppressClick = false;

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
    this._resize = null;
    this._observed = null;
  }

  override updated() {
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
      : nothing;
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
      <div class="axis">
        <div class="gutter"></div>
        <div class="ticks" ${ref(this._ticksRef)}>
          ${this._width > 0 ? this._renderTicks(scale) : nothing}
        </div>
      </div>
      <div
        class="lanes ${this._drag?.moved ? 'dragging' : ''}"
        data-tip="Wheel to zoom, drag to pan, double-click to fit"
        @wheel=${this._onWheel}
        @pointerdown=${this._onPointerDown}
        @pointermove=${this._onPointerMove}
        @pointerup=${this._onPointerUp}
        @pointercancel=${this._onPointerUp}
        @dblclick=${this._refit}
      >
        ${this._tracks.map((track) => this._renderLane(track, scale))}
      </div>
      ${detail}
    `;
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
          if (e.key === 'Enter' || e.key === ' ') {
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
