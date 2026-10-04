import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ref, createRef} from 'lit/directives/ref.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import './wa-icons.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type WaSelect from '@awesome.me/webawesome/dist/components/select/select.js';
import {tokens} from '../lib/tokens.js';
import type {
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';
import {TimelineModel} from '../lib/timeline/model.js';
import './segmented-tabs.js';
import type {TabItem} from './segmented-tabs.js';
import './timeline-layers.js';
import './timeline-event-list.js';
import type {TimelineEventList} from './timeline-event-list.js';
import './timeline-tracks.js';
import {litRpc, getMeta, describeError} from './client.js';
import {LocationController} from './location-controller.js';
import {PanelLocation} from './panel-location.js';
import {hostInfo} from './host.js';
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
/** Layers that only gate extra data on other layers' events: they get a pill
 *  to toggle but never a lane. */
const EVENTLESS_LAYERS = new Set(['lit-changed-values']);

/** Layers fed by Lit's own `lit-debug` events, which only its dev build emits. */
const LIT_DEBUG_LAYERS = new Set(['lit-render', 'lit-render-verbose']);

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
 * (`timeline-tracks`). This view holds one `TimelineModel` for both: the
 * spans, the selection and the element/regex filter, so clicking a mark and
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
      .export-note {
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-2xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hint {
        margin: 0;
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-4);
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-2xs);
      }
      .record:not(.active) wa-icon {
        color: var(--wa-color-danger-fill-loud);
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
      .filterbar wa-select {
        min-width: 160px;
        font-family: var(--lit-devtools-font-mono);
      }
      .filterbar wa-input.regex {
        min-width: 140px;
        font-family: var(--lit-devtools-font-mono);
      }
      .filterbar wa-input.regex.invalid {
        --wa-form-control-border-color: var(--wa-color-danger-border-loud);
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
  /** Whether a session state has been applied yet. The first one is the
   *  panel catching up with a recording already under way, not a start. */
  private _sessionSeen = false;
  @state() private _exporting = false;
  /** Result or failure of the last export; `null` until one is attempted. */
  @state() private _exportNote: string | null = null;
  /** Whether the host can write a snapshot (`capabilities.exportSnapshot`);
   *  without it the button is left out rather than left to fail. */
  @state() private _canExport = false;
  /** Whether the page is served by Vite (`capabilities.hmr`). Off the Vite
   *  plugin the page's Lit may well be a production build, which emits no
   *  `lit-debug` events, so an empty render layer needs explaining. */
  @state() private _vite = true;
  /** A frozen snapshot: nothing to record, and no server to tell. */
  @state() private _snapshot = false;
  @state() private _events: TimelineEvent[] = [];
  @state() private _layers: LayerState[] = [];
  @state() private _error: string | null = null;
  @state() private _mode: ViewMode = readMode();
  /** Layers whose track the user hid. View-only: capture is untouched. */
  @state() private _hiddenTracks: Set<string> = readHiddenTracks();
  /** Spans, filter and selection shared by both presentations. Not
   *  reactive itself: every mutation is followed by `requestUpdate()`. */
  private readonly _model = new TimelineModel();
  /** The selected span's start event as last reported to the location. */
  private _announcedEventId: string | null = null;

  /** Where the panel is; the shell hands its own in. */
  @property({attribute: false}) location = new PanelLocation();

  protected readonly _locationController = new LocationController(this, () => {
    this._resolveRequest();
    this.requestUpdate();
  });
  private _revealSelection = false;
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
        .filter(
          (l) =>
            l.enabled &&
            !this._hiddenTracks.has(l.id) &&
            !EVENTLESS_LAYERS.has(l.id)
        )
        .map((l) => l.id);
    }
    if (this._model.setEvents(this._events)) this._resolveRequest();
  }

  /**
   * Select the span a link's event id names, once the buffer has loaded: an
   * empty buffer is "not loaded yet", so the id waits in the location. An id
   * the loaded buffer does not hold clears the selection.
   */
  private _resolveRequest(): void {
    const id = this.location.requested('timeline');
    if (id === undefined || this._model.events.length === 0) return;
    if (this._model.selectEvent(id)) this._revealSelection = true;
    this._announcedEventId = this._model.selectedEventId;
    this.location.resolve('timeline', this._announcedEventId);
  }

  override updated() {
    if (this._revealSelection) {
      this._revealSelection = false;
      // After the *list's* update, not ours: it pins itself to the newest row
      // whenever its events change, which is exactly when a cold link lands.
      void this.updateComplete
        .then(() => this._listRef.value?.updateComplete)
        .then(() => this._listRef.value?.reveal());
    }
    // A click, or a span leaving the buffer. Not while a link is still
    // waiting for its events: that would drop it.
    const id = this._model.selectedEventId;
    if (
      id !== this._announcedEventId &&
      this.location.requested('timeline') === undefined
    ) {
      this._announcedEventId = id;
      this.location.select('timeline', id);
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
      const [rpc, meta, host] = await Promise.all([
        litRpc(),
        getMeta(),
        hostInfo(),
      ]);
      if (!this._active) return;
      this._rpc = rpc;
      this._baseLayers = meta.layers;
      this._canExport = host.exportSnapshot;
      this._vite = host.hmr;
      this._snapshot = host.snapshot;

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
    //
    // Only a start the panel *watched*: the first state it applies is not an
    // edge. A panel opened (or reloaded) mid-recording sees `false` -> `true`
    // against its own default, and clearing then would wipe the events the
    // stream just replayed to it.
    if (this._sessionSeen && recordingState && !this._recording) {
      clearTimelineEvents();
    }
    this._sessionSeen = true;
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
    const v = (e.target as WaSelect).value as string;
    this._model.setFilter({elementId: v === '' ? null : Number(v)});
    this.requestUpdate();
  }

  private _onRegexInput(e: Event) {
    this._model.setFilter({regex: (e.target as WaInput).value ?? ''});
    this.requestUpdate();
  }

  /** The detail pane's **filter** link. */
  private _onElementFilter(e: CustomEvent<{id: number}>) {
    this._model.setFilter({elementId: e.detail.id});
    this.requestUpdate();
  }

  private _onSpanSelect(e: CustomEvent<{key: string | null}>) {
    this._model.select(e.detail.key);
    this.requestUpdate();
  }

  /**
   * One line under the layers when the render layers are on, other events
   * have arrived, and none of them came from Lit: off the Vite plugin that
   * almost always means the page runs Lit's production build. Under Vite the
   * dev build is what gets served, so an empty layer there means something
   * else and no hint is shown.
   */
  private _renderDebugHint() {
    if (this._vite || this._events.length === 0) return nothing;
    const on = this._layers.some(
      (l) => l.enabled && LIT_DEBUG_LAYERS.has(l.id)
    );
    if (!on || this._events.some((e) => LIT_DEBUG_LAYERS.has(e.layerId))) {
      return nothing;
    }
    return html`<p class="hint">
      No Lit render events yet. Lit emits them only from its development build;
      a production build leaves these layers empty.
    </p>`;
  }

  override render() {
    if (this._error !== null) {
      return html`<div class="error">${this._error}</div>`;
    }
    const tracks = this._mode === 'tracks';
    // Only captured layers can have events to draw.
    const captured = this._layers.filter(
      (l) => l.enabled && !EVENTLESS_LAYERS.has(l.id)
    );
    const model = this._model;
    const {filter} = model;
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
        ${
          this._canExport
            ? html`<wa-button
                class="export"
                size="small"
                appearance="outlined"
                ?disabled=${this._exporting}
                data-tip="Write this session to a static panel directory you can attach to a bug report"
                @click=${this._exportSnapshot}
              >
                <wa-icon slot="start" name="export"></wa-icon>
                Export snapshot
              </wa-button>`
            : nothing
        }
        <wa-button
          size="small"
          appearance="outlined"
          data-tip="Delete every recorded event"
          @click=${this._clear}
        >
          <wa-icon slot="start" name="trash"></wa-icon>
          Clear
        </wa-button>
        ${
          // A frozen session has nothing to record and no server to tell.
          this._snapshot
            ? nothing
            : html`<wa-button
                class="record ${this._recording ? 'active' : ''}"
                size="small"
                variant=${this._recording ? 'danger' : 'neutral'}
                appearance=${this._recording ? 'filled' : 'outlined'}
                data-tip=${this._recording ? 'Stop recording' : 'Start recording'}
                @click=${this._toggleRecord}
              >
                <wa-icon
                  slot="start"
                  name=${this._recording ? 'stop' : 'record'}
                ></wa-icon>
                ${this._recording ? 'Stop' : 'Record'}
              </wa-button>`
        }
      </div>
      <timeline-layers
        .layers=${this._layers}
        @layer-toggle=${this._onLayerToggle}
      ></timeline-layers>
      ${this._renderDebugHint()}
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
                model.elements.length > 0
                  ? html`
                      <span>Element:</span>
                      <wa-select
                        size="small"
                        .value=${
                          filter.elementId === null
                            ? ''
                            : String(filter.elementId)
                        }
                        @change=${this._onElementSelect}
                      >
                        <wa-option value="">All elements</wa-option>
                        ${model.elements.map(
                          (el) => html`
                            <wa-option value=${String(el.id)}>
                              &lt;${el.tag}&gt; #${el.id}
                            </wa-option>
                          `
                        )}
                      </wa-select>
                    `
                  : nothing
              }
              <wa-input
                class="regex ${model.regexInvalid ? 'invalid' : ''}"
                size="small"
                type="text"
                spellcheck="false"
                placeholder="filter regex…"
                data-tip="Case-insensitive regex matched against element tag, title and subtitle"
                .value=${filter.regex}
                @input=${this._onRegexInput}
              ></wa-input>
            </div>`
          : nothing
      }
      <timeline-event-list
        ${ref(this._listRef)}
        ?hidden=${tracks}
        .events=${this._events}
        .spans=${model.spans}
        .layers=${this._layers}
        .selectedKey=${model.selectedKey}
        .filter=${filter}
        @span-select=${this._onSpanSelect}
        @element-filter=${this._onElementFilter}
      ></timeline-event-list>
      <timeline-tracks
        ?hidden=${!tracks}
        .spans=${model.filteredSpans}
        .layers=${this._layers}
        .visibleTracks=${this._visibleTracks}
        .selectedKey=${model.selectedKey}
        .selectedSpan=${model.selectedSpan}
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
