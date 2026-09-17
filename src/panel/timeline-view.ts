/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css} from 'lit';
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
import {litRpc, getMeta, describeError} from './client.js';
import type {LitClient} from './client.js';
import {LAYER_FLAGS, SESSION_STATE_KEY} from '../lib/devframe/protocol.js';
import type {SessionState} from '../lib/devframe/protocol.js';

/**
 * Cap on retained timeline events. The stream is unbounded (the mouse/keyboard
 * layers can emit at pointer-move rate), so without a cap the buffer — and the
 * list that re-renders from it — grows for the whole session. Keep the most
 * recent events; older ones scroll off.
 */
const MAX_EVENTS = 5000;

/**
 * The Timeline view: records and lists Lit lifecycle / render / input events.
 * One tab of the DevTools panel shell (`lit-devtools-panel`); owns its own
 * devframe RPC subscription (a replayed streaming channel), recording state
 * and layer toggles so it keeps recording while other tabs are in front. The
 * recording flag and layer toggles live in devframe shared state, so this
 * view stays in sync with other panels and the page runtime.
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
  @state() private _events: TimelineEvent[] = [];
  @state() private _layers: LayerState[] = [];
  @state() private _error: string | null = null;

  /** Built-in + runtime-announced layers as of the last `get-meta` call. */
  private _baseLayers: TimelineLayer[] = [];
  private _rpc: LitClient | null = null;
  private _reader: {cancel: () => void} | null = null;
  private _sessionOff: (() => void) | null = null;
  /** False once `disconnectedCallback` runs, so a slow connect (or a stream
   *  error racing a cancel) never touches state after teardown. */
  private _active = false;

  override connectedCallback() {
    super.connectedCallback();
    this._active = true;
    void this._connect();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._active = false;
    this._reader?.cancel();
    this._reader = null;
    this._sessionOff?.();
    this._sessionOff = null;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Connects to the devframe RPC client, loads the layer list and shared
   * session state, and then drains the replayed timeline stream until the
   * view disconnects or the stream ends. Every step checks `_active` so a
   * teardown mid-connect (or a cancel racing the stream's end) never mutates
   * state after the component is gone, and the whole flow is one try/catch
   * so a rejected connect or stream never surfaces as an unhandled rejection.
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

      const reader = rpc.rpc.streaming.subscribe<TimelineEvent[]>(
        meta.stream.channel,
        meta.stream.id,
        {highWaterMark: 4096}
      );
      if (!this._active) {
        reader.cancel();
        return;
      }
      this._reader = reader;

      // No recording check here: every capture layer in the page runtime is
      // already gated on the recording flag, so anything that reaches the
      // stream was recorded on purpose. Gating again client-side would throw
      // away the replayed buffer that makes a late-opened panel useful.
      for await (const batch of reader) {
        const next = [...this._events, ...batch];
        this._events =
          next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      }
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
    this._recording = state.layers.recordingState;
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
    this._events = [];
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
        <span class="spacer"></span>
        <button @click=${this._clear}>Clear</button>
        <button
          class="record ${this._recording ? 'active' : ''}"
          @click=${this._toggleRecord}
        >
          ${this._recording ? '⏹ Stop' : '▶ Record'}
        </button>
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
