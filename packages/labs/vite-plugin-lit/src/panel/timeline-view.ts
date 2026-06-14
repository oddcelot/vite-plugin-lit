/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import type {TimelineEvent, TimelineLayer} from '../types/timeline.js';
import {TIMELINE_LAYERS} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';
import './timeline-layers.js';
import './timeline-event-list.js';

const LS_KEY = 'lit-devtools-timeline-layers';

/**
 * The Timeline view: records and lists Lit lifecycle / render / input events.
 * One tab of the DevTools panel shell (`timeline-app`); owns its own event
 * stream (SSE), recording state and layer toggles so it keeps recording while
 * other tabs are in front.
 */
@customElement('timeline-view')
export class TimelineView extends LitElement {
  static override styles = css`
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
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid #2d2d35;
      background: #16161b;
      flex-shrink: 0;
    }
    .spacer {
      flex: 1;
    }
    button {
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid #2d2d35;
      background: #2d2d35;
      color: #d4d4d8;
      font-size: 11px;
      cursor: pointer;
    }
    button:hover {
      background: #3d3d45;
      border-color: #3d3d45;
    }
    .record.active {
      border-color: #ef4444;
      background: #7f1d1d;
      color: #fca5a5;
    }
    timeline-event-list {
      flex: 1;
      overflow: hidden;
    }
  `;

  @state() private _recording = false;
  @state() private _events: TimelineEvent[] = [];
  @state() private _layers: LayerState[] = TIMELINE_LAYERS.map((l) => ({
    ...l,
    enabled: true,
  }));

  private _es: EventSource | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._loadStorage();
    this._es = new EventSource('/__lit-devtools-events');
    this._es.onmessage = (e: MessageEvent<string>) => {
      if (!this._recording) return;
      try {
        const batch = JSON.parse(e.data) as TimelineEvent[];
        if (Array.isArray(batch)) {
          this._events = [...this._events, ...batch];
        }
      } catch {
        // ignore malformed data
      }
    };
    // Custom layers pushed from app code via addTimelineLayer().
    this._es.addEventListener('layer', (e: Event) => {
      try {
        const layer = JSON.parse(
          (e as MessageEvent<string>).data
        ) as TimelineLayer;
        if (layer?.id && !this._layers.some((l) => l.id === layer.id)) {
          this._layers = [...this._layers, {...layer, enabled: true}];
        }
      } catch {
        // ignore
      }
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._es?.close();
    this._es = null;
  }

  // ---------------------------------------------------------------------------
  // State persistence
  // ---------------------------------------------------------------------------

  private _loadStorage(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw !== null) {
        const saved = JSON.parse(raw) as Record<string, boolean>;
        this._layers = this._layers.map((l) => ({
          ...l,
          enabled: saved[l.id] ?? l.enabled,
        }));
      }
    } catch {
      // ignore (private/storage unavailable)
    }
  }

  private _saveStorage(): void {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify(
          Object.fromEntries(this._layers.map((l) => [l.id, l.enabled]))
        )
      );
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Server sync
  // ---------------------------------------------------------------------------

  private _layersToState(): Record<string, boolean> {
    const enabled = (id: string): boolean =>
      this._layers.find((l) => l.id === id)?.enabled ?? true;
    return {
      litLifecycleEnabled: enabled('lit-lifecycle'),
      litRenderEnabled: enabled('lit-render'),
      mouseEventEnabled: enabled('mouse'),
      keyboardEventEnabled: enabled('keyboard'),
    };
  }

  /** POST layer/recording state to the server control endpoint. */
  private _postControl(body: Record<string, unknown>): void {
    fetch('/__lit-devtools-control', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    }).catch(() => {
      // dev tool — ignore network errors
    });
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private _toggleRecord() {
    this._recording = !this._recording;
    this._postControl({recording: this._recording});
  }

  private _clear() {
    this._events = [];
  }

  private _onLayerToggle(e: CustomEvent<{id: string}>) {
    this._layers = this._layers.map((l) =>
      l.id === e.detail.id ? {...l, enabled: !l.enabled} : l
    );
    this._postControl(this._layersToState());
    this._saveStorage();
  }

  override render() {
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
