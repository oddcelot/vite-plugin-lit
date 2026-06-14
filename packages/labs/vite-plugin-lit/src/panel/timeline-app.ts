/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import type {TimelineEvent} from '../types/timeline.js';
import {TIMELINE_LAYERS} from '../types/timeline.js';
import type {LayerState} from './timeline-layers.js';
import './timeline-layers.js';
import './timeline-event-list.js';

/** Root element of the Lit Timeline DevTools panel. */
@customElement('timeline-app')
export class TimelineApp extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family:
        system-ui,
        -apple-system,
        sans-serif;
      font-size: 13px;
      background: #1a1a1f;
      color: #d4d4d8;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid #2d2d35;
      background: #16161b;
      flex-shrink: 0;
    }
    .logo {
      color: #4fc08d;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
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
    this._es = new EventSource('/__lit-timeline-events');
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
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._es?.close();
    this._es = null;
  }

  private _toggleRecord() {
    this._recording = !this._recording;
    // Relay recording state to the app via the server.
    // postMessage reaches the devtools shell (same origin); the server then
    // broadcasts lit:timeline:recording-changed to all connected browser tabs.
    window.parent.postMessage(
      {type: '__lit_timeline_set_recording', recording: this._recording},
      '*'
    );
  }

  private _clear() {
    this._events = [];
  }

  private _onLayerToggle(e: CustomEvent<{id: string}>) {
    this._layers = this._layers.map((l) =>
      l.id === e.detail.id ? {...l, enabled: !l.enabled} : l
    );
  }

  override render() {
    return html`
      <header>
        <span class="logo">Lit Timeline</span>
        <span class="spacer"></span>
        <button @click=${this._clear}>Clear</button>
        <button
          class="record ${this._recording ? 'active' : ''}"
          @click=${this._toggleRecord}
        >
          ${this._recording ? '⏹ Stop' : '▶ Record'}
        </button>
      </header>
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
    'timeline-app': TimelineApp;
  }
}
