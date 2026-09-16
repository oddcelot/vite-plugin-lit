/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {tokens} from '../lib/tokens.js';
import type {TimelineEvent, TimelineLayer} from '../types/timeline.js';
import {TIMELINE_LAYERS} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';
import './timeline-layers.js';
import './timeline-event-list.js';

const LS_KEY = 'lit-devtools-timeline-layers';

/**
 * Cap on retained timeline events. The stream is unbounded (the mouse/keyboard
 * layers can emit at pointer-move rate), so without a cap the buffer — and the
 * list that re-renders from it — grows for the whole session. Keep the most
 * recent events; older ones scroll off.
 */
const MAX_EVENTS = 5000;

/**
 * The Timeline view: records and lists Lit lifecycle / render / input events.
 * One tab of the DevTools panel shell (\`lit-devtools-panel\`); owns its own event
 * stream (SSE), recording state and layer toggles so it keeps recording while
 * other tabs are in front.
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
    `,
  ];

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
          const next = [...this._events, ...batch];
          this._events =
            next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
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
    }).catch((err) => {
      console.warn('[lit-devtools] control POST failed', err);
    });
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private _toggleRecord() {
    this._recording = !this._recording;
    // On start, push the current layer enablement together with the recording
    // flag: the runtime defaults mouse/keyboard capture off, and otherwise only
    // hears about layers when one is toggled — so those layers wouldn't record
    // on the first session until the user toggled one. Send the full state so
    // the runtime matches what the panel shows from the first event.
    this._postControl(
      this._recording
        ? {recording: true, ...this._layersToState()}
        : {recording: false}
    );
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
