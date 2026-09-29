/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import {tokens} from '../lib/tokens.js';
import type {
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';
import {toSpans} from '../lib/timeline/derive.js';
import {
  compileRegex,
  filterSpans,
  listElements,
} from '../lib/timeline/filter.js';
import type {TimelineSpan} from '../lib/timeline/derive.js';
import '../lib/segmented-tabs.js';
import type {TabItem} from '../lib/segmented-tabs.js';
import './timeline-layers.js';
import {isRawKey} from './timeline-event-list.js';
import type {TimelineEventList} from './timeline-event-list.js';
import './timeline-tracks.js';
import {litRpc, getMeta, describeError, isSnapshot} from './client.js';
import {
  clearTimelineEvents,
  getTimelineError,
  getTimelineEvents,
  subscribeTimeline,
} from './timeline-store.js';
import type {LitClient} from './client.js';
import {LAYER_FLAGS, SESSION_STATE_KEY} from '../lib/devframe/protocol.js';
import type {SessionState} from '../lib/devframe/protocol.js';

type ViewMode = 'list' | 'tracks';

/** localStorage key remembering List vs Tracks. */
const MODE_LS_KEY = 'lit-devtools-timeline-mode';
/** localStorage key remembering which tracks the user hid. Stored as the
 *  hidden set, not the shown one, so a layer seen for the first time (a
 *  custom layer, a new built-in) gets a track by default. */
const HIDDEN_TRACKS_LS_KEY = 'lit-devtools-timeline-hidden-tracks';

const MODE_TABS: TabItem[] = [
  {id: 'list', label: 'List'},
  {id: 'tracks', label: 'Tracks'},
];

const readMode = (): ViewMode => {
  try {
    return localStorage.getItem(MODE_LS_KEY) === 'tracks' ? 'tracks' : 'list';
  } catch {
    return 'list';
  }
};

const readHiddenTracks = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(HIDDEN_TRACKS_LS_KEY) ?? '[]'
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : []
    );
  } catch {
    return new Set();
  }
};

const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore (private/storage unavailable)
  }
};

/**
 * The Timeline view: records and lists Lit lifecycle / render / input events.
 * One tab of the DevTools panel shell (`lit-devtools-panel`). The recorded
 * events come from `timeline-store.ts`, which the Updates view reads too; this
 * view owns the recording state and layer toggles, which live in devframe
 * shared state so it stays in sync with other panels and the page runtime.
 *
 * The events are shown two ways, List (`timeline-event-list`) and Tracks
 * (`timeline-tracks`). This view derives the spans once for both and owns
 * the selection and the element/regex filter, so clicking a mark and
 * switching to the list lands on the same row, and a filter typed in one
 * presentation is still applied in the other. Both stay mounted and the
 * inactive one is hidden, so the list keeps its Raw toggle and scroll and the
 * tracks keep their zoom.
 */
@customElement('timeline-view')
export class TimelineView extends LitElement {
  static override styles = [
    tokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
      :host([hidden]) {
        display: none;
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-4);
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        flex-shrink: 0;
      }
      .spacer {
        flex: 1;
      }
      button {
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
        border-radius: var(--lit-devtools-radius-sm);
        border: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text);
        font-size: var(--lit-devtools-text-2xs);
        cursor: pointer;
      }
      button:hover {
        background: var(--lit-devtools-surface-hover);
        border-color: var(--lit-devtools-border-strong);
      }
      .export-note {
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-2xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .record.active {
        border-color: var(--lit-devtools-error);
        background: var(--lit-devtools-error-soft);
        color: var(--lit-devtools-error);
      }
      .toolbar segmented-tabs {
        align-self: stretch;
        margin: calc(-1 * var(--lit-devtools-space-3)) 0;
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
      .filterbar select,
      .filterbar input.regex {
        background: var(--lit-devtools-surface-elevated);
        color: var(--lit-devtools-text);
        border: 1px solid var(--lit-devtools-border-strong);
        border-radius: var(--lit-devtools-radius-sm);
        padding: var(--lit-devtools-space-1) var(--lit-devtools-space-3);
        font-size: var(--lit-devtools-text-2xs);
        font-family: var(--lit-devtools-font-mono);
      }
      .filterbar input.regex {
        min-width: 140px;
      }
      .filterbar input.regex::placeholder {
        color: var(--lit-devtools-text-muted);
      }
      .filterbar input.regex.invalid {
        border-color: var(--lit-devtools-error);
      }
      timeline-event-list,
      timeline-tracks {
        flex: 1;
        overflow: hidden;
      }
      [hidden] {
        display: none !important;
      }
      .error {
        padding: var(--lit-devtools-space-5);
        color: var(--lit-devtools-text-secondary);
        font-size: var(--lit-devtools-text-xs);
      }
    `,
  ];

  @state() private _recording = false;
  @state() private _exporting = false;
  /** Result or failure of the last export; `null` until one is attempted. */
  @state() private _exportNote: string | null = null;
  @state() private _events: TimelineEvent[] = [];
  @state() private _layers: LayerState[] = [];
  @state() private _error: string | null = null;
  @state() private _mode: ViewMode = readMode();
  /** Layers whose track the user hid. View-only: capture is untouched. */
  @state() private _hiddenTracks: Set<string> = readHiddenTracks();
  /** Selection shared by both presentations; see `timeline-event-list`. */
  @state() private _selectedKey: string | null = null;
  /** Element id both presentations are filtered to, or null for all. */
  @state() private _elementFilter: number | null = null;
  /** Case-insensitive regex source both presentations are filtered by. */
  @state() private _regex = '';

  /** `toSpans(_events)`, re-derived only when the buffer changes. */
  private _spans: TimelineSpan[] = [];
  private _spansOf: TimelineEvent[] | null = null;
  /** Distinct elements in `_events`, re-derived with `_spans` so a keystroke
   *  in the regex box does not rescan the buffer. */
  private _elements: Array<{id: number; tag: string}> = [];
  /** `_spans` after the element and regex filters, for Tracks. The list
   *  applies the same filter itself because its Raw mode filters events. */
  private _filteredSpans: TimelineSpan[] = [];
  private readonly _listRef = createRef<TimelineEventList>();
  /** Captured, not-hidden layer ids. Cached so a selection change does not
   *  hand `timeline-tracks` a new array and re-pack every lane. */
  private _visibleTracks: string[] = [];

  /** Built-in + runtime-announced layers as of the last `get-meta` call. */
  private _baseLayers: TimelineLayer[] = [];
  private _rpc: LitClient | null = null;
  private _sessionOff: (() => void) | null = null;
  private _storeOff: (() => void) | null = null;
  /** False once `disconnectedCallback` runs, so a slow connect (or a stream
   *  error racing a cancel) never touches state after teardown. */
  private _active = false;

  override connectedCallback() {
    super.connectedCallback();
    this._active = true;
    this._storeOff = subscribeTimeline(() => this._readStore());
    this._readStore();
    void this._connect();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._active = false;
    this._sessionOff?.();
    this._sessionOff = null;
    this._storeOff?.();
    this._storeOff = null;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('_layers') || changed.has('_hiddenTracks')) {
      this._visibleTracks = this._layers
        .filter((l) => l.enabled && !this._hiddenTracks.has(l.id))
        .map((l) => l.id);
    }
    // The store hands out a new array whenever the buffer changes, so identity
    // is the memo key.
    if (this._events !== this._spansOf) {
      this._spansOf = this._events;
      this._spans = toSpans(this._events);
      this._elements = listElements(this._events);
      // Drop a stale element filter when its element is no longer recorded
      // (e.g. after Clear), otherwise both views would silently show nothing.
      if (
        this._elementFilter !== null &&
        !this._elements.some((el) => el.id === this._elementFilter)
      ) {
        this._elementFilter = null;
      }
      // A span can fall out of the buffer cap, or vanish on Clear. Raw-mode
      // keys are the list's to interpret.
      const key = this._selectedKey;
      if (
        key !== null &&
        !isRawKey(key) &&
        !this._spans.some((s) => s.key === key)
      ) {
        this._selectedKey = null;
      }
    }
    if (
      changed.has('_events') ||
      changed.has('_elementFilter') ||
      changed.has('_regex')
    ) {
      // Recomputed on its own inputs only, so a selection change does not hand
      // `timeline-tracks` a new array and re-pack every lane.
      this._filteredSpans = filterSpans(
        this._spans,
        this._elementFilter,
        compileRegex(this._regex).re
      );
    }
  }

  private _readStore(): void {
    if (!this._active) return;
    this._events = getTimelineEvents();
    const storeError = getTimelineError();
    if (storeError !== null) this._error = storeError;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Connects to the devframe RPC client and loads the layer list and shared
   * session state. The recorded events arrive separately, through
   * `timeline-store.ts`. Every step checks `_active` so a teardown mid-connect
   * never mutates state after the component is gone, and the whole flow is one
   * try/catch so a rejected connect never surfaces as an unhandled rejection.
   */
  private async _connect(): Promise<void> {
    try {
      const [rpc, meta] = await Promise.all([litRpc(), getMeta()]);
      if (!this._active) return;
      this._rpc = rpc;
      this._baseLayers = meta.layers;

      const session =
        await rpc.rpc.sharedState<SessionState>(SESSION_STATE_KEY);
      if (!this._active) return;
      this._applySession(session.value());
      this._sessionOff = session.on('updated', (state) =>
        this._applySession(state)
      );
    } catch (err) {
      if (this._active) {
        this._error = describeError(err);
      }
    }
  }

  /** Applies a `SessionState` snapshot (initial or from `session.on('updated', …)`)
   *  to the recording flag and merged layer list. */
  private _applySession(state: {
    layers: TimelineLayersState;
    customLayers: readonly TimelineLayer[];
  }): void {
    const {recordingState} = state.layers;
    // The page re-zeroes its timeline clock on the rising edge of recording
    // (`runtime/timeline/clock.ts`), so the previous recording's events carry
    // times above everything captured after them. Keeping them would render a
    // list that runs backwards mid-scroll -- and, once spans are paired by
    // time, negative durations across the seam. The dev server drops its own
    // buffer on the same edge (`devframe/definition.ts`).
    if (recordingState && !this._recording) {
      clearTimelineEvents();
    }
    this._recording = recordingState;
    this._layers = this._mergeLayers(state.layers, state.customLayers);
  }

  /** Merges the base (built-in + already-known custom) layers with any custom
   *  layers announced since, and resolves each one's enabled flag. Custom
   *  layers have no entry in `LAYER_FLAGS` and are always enabled. */
  private _mergeLayers(
    flags: TimelineLayersState,
    customLayers: readonly TimelineLayer[]
  ): LayerState[] {
    const merged = [...this._baseLayers];
    for (const layer of customLayers) {
      if (!merged.some((l) => l.id === layer.id)) {
        merged.push(layer);
      }
    }
    return merged.map((l) => {
      const flag = LAYER_FLAGS[l.id];
      return {...l, enabled: flag ? flags[flag] : true};
    });
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private _toggleRecord() {
    this._rpc?.rpc
      .call('set-recording', {recording: !this._recording})
      .catch((err) => {
        console.warn('[lit-devtools] set-recording failed', err);
      });
  }

  private _clear() {
    clearTimelineEvents();
  }

  /**
   * Freeze this session into a static panel directory the developer can zip
   * onto an issue. The dev server does the work -- it already holds the
   * timeline, the tree and the details -- so this is one call and a status
   * line, not a download.
   */
  private _exportSnapshot() {
    if (this._exporting) return;
    this._exporting = true;
    this._exportNote = 'Exporting…';
    this._rpc?.rpc
      .call('export-snapshot', {})
      .then((result) => {
        this._exportNote = `Wrote ${result.events} events and ${result.components} components to ${result.outDir}`;
      })
      .catch((err: unknown) => {
        this._exportNote = `Export failed: ${describeError(err)}`;
      })
      .finally(() => {
        this._exporting = false;
      });
  }

  private _onLayerToggle(e: CustomEvent<{id: string}>) {
    // Custom layers have no flag in `LAYER_FLAGS` and are always on; there is
    // nothing to toggle server-side.
    if (!LAYER_FLAGS[e.detail.id]) return;
    const layer = this._layers.find((l) => l.id === e.detail.id);
    if (!layer) return;
    this._rpc?.rpc
      .call('toggle-layer', {layerId: e.detail.id, enabled: !layer.enabled})
      .catch((err) => {
        console.warn('[lit-devtools] toggle-layer failed', err);
      });
  }

  private _onModeChange(e: CustomEvent<{value: string}>) {
    e.stopPropagation();
    this._mode = e.detail.value === 'tracks' ? 'tracks' : 'list';
    store(MODE_LS_KEY, this._mode);
    if (this._mode === 'list') {
      // The list was hidden while the selection may have moved; bring the
      // selected row (or the newest one) back into view.
      void this.updateComplete.then(() => this._listRef.value?.reveal());
    }
  }

  private _onTrackToggle(e: CustomEvent<{id: string}>) {
    // A view filter: this deliberately does not call `toggle-layer`.
    e.stopPropagation();
    const hidden = new Set(this._hiddenTracks);
    if (!hidden.delete(e.detail.id)) hidden.add(e.detail.id);
    this._hiddenTracks = hidden;
    store(HIDDEN_TRACKS_LS_KEY, JSON.stringify([...hidden]));
  }

  private _onElementSelect(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    this._elementFilter = v === '' ? null : Number(v);
  }

  private _onRegexInput(e: Event) {
    this._regex = (e.target as HTMLInputElement).value;
  }

  /** The detail pane's **filter** link. */
  private _onElementFilter(e: CustomEvent<{id: number}>) {
    this._elementFilter = e.detail.id;
  }

  private _onSpanSelect(e: CustomEvent<{key: string | null}>) {
    this._selectedKey = e.detail.key;
  }

  override render() {
    if (this._error !== null) {
      return html`<div class="error">${this._error}</div>`;
    }
    const tracks = this._mode === 'tracks';
    // Only captured layers can have events to draw.
    const captured = this._layers.filter((l) => l.enabled);
    return html`
      <div class="toolbar">
        <segmented-tabs
          size="sm"
          .items=${MODE_TABS}
          .value=${this._mode}
          @change=${this._onModeChange}
        ></segmented-tabs>
        ${
          this._exportNote === null
            ? nothing
            : html`<span class="export-note">${this._exportNote}</span>`
        }
        <span class="spacer"></span>
        <button
          ?disabled=${this._exporting || isSnapshot()}
          title="Write this session to a static panel directory you can attach to a bug report"
          @click=${this._exportSnapshot}
        >
          Export snapshot
        </button>
        <button @click=${this._clear}>Clear</button>
        ${
          // A frozen session has nothing to record and no server to tell.
          isSnapshot()
            ? nothing
            : html`<button
                class="record ${this._recording ? 'active' : ''}"
                @click=${this._toggleRecord}
              >
                ${this._recording ? '⏹ Stop' : '▶ Record'}
              </button>`
        }
      </div>
      <timeline-layers
        .layers=${this._layers}
        @layer-toggle=${this._onLayerToggle}
      ></timeline-layers>
      ${
        tracks
          ? html`<timeline-layers
              caption="Tracks"
              .layers=${captured.map((l) => ({
                ...l,
                enabled: !this._hiddenTracks.has(l.id),
              }))}
              @layer-toggle=${this._onTrackToggle}
            ></timeline-layers>`
          : nothing
      }
      ${
        this._events.length > 0
          ? html`<div class="filterbar">
              ${
                this._elements.length > 0
                  ? html`
                      <span>Element:</span>
                      <select @change=${this._onElementSelect}>
                        <option
                          value=""
                          ?selected=${this._elementFilter === null}
                        >
                          All elements
                        </option>
                        ${this._elements.map(
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
                class="regex ${compileRegex(this._regex).invalid ? 'invalid' : ''}"
                type="text"
                spellcheck="false"
                placeholder="filter regex…"
                title="Case-insensitive regex matched against element tag, title and subtitle"
                .value=${this._regex}
                @input=${this._onRegexInput}
              />
            </div>`
          : nothing
      }
      <timeline-event-list
        ${ref(this._listRef)}
        ?hidden=${tracks}
        .events=${this._events}
        .spans=${this._spans}
        .layers=${this._layers}
        .selectedKey=${this._selectedKey}
        .elementFilter=${this._elementFilter}
        .regex=${this._regex}
        @span-select=${this._onSpanSelect}
        @element-filter=${this._onElementFilter}
      ></timeline-event-list>
      <timeline-tracks
        ?hidden=${!tracks}
        .spans=${this._filteredSpans}
        .layers=${this._layers}
        .visibleTracks=${this._visibleTracks}
        .selectedKey=${this._selectedKey}
        ?recording=${this._recording}
        @span-select=${this._onSpanSelect}
        @element-filter=${this._onElementFilter}
      ></timeline-tracks>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-view': TimelineView;
  }
}
