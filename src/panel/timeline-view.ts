/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {tokens} from '../lib/tokens.js';
import type {
  TimelineEvent,
  TimelineLayer,
  TimelineLayersState,
} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';
import './timeline-layers.js';
import './timeline-event-list.js';
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

/**
 * The Timeline view: records and lists Lit lifecycle / render / input events.
 * One tab of the DevTools panel shell (`lit-devtools-panel`). The recorded
 * events come from `timeline-store.ts`, which the Updates view reads too; this
 * view owns the recording state and layer toggles, which live in devframe
 * shared state so it stays in sync with other panels and the page runtime.
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
      timeline-event-list {
        flex: 1;
        overflow: hidden;
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

  override render() {
    if (this._error !== null) {
      return html`<div class="error">${this._error}</div>`;
    }
    return html`
      <div class="toolbar">
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
      <timeline-event-list
        .events=${this._events}
        .layers=${this._layers}
      ></timeline-event-list>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'timeline-view': TimelineView;
  }
}
