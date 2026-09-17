/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {tokens} from '../lib/tokens.js';
import {
  attributeInput,
  rollup,
  toSpans,
  toUpdateCycles,
} from '../lib/timeline/derive.js';
import type {ComponentRollup, UpdateCycle} from '../lib/timeline/derive.js';
import type {TimelineEvent} from '../types/timeline.js';
import {
  getTimelineError,
  getTimelineEvents,
  subscribeTimeline,
} from './timeline-store.js';
import {openInEditor} from './open-in-editor.js';

/**
 * The Updates view: which components re-rendered, how often, how long for, and
 * why.
 *
 * The Timeline answers "what happened, in what order". This answers the two
 * questions that actually send a developer to a devtools panel — *which
 * component updates too much* (the table) and *why did this one update* (the
 * cycle list, keyed on the changed reactive properties). Both are derived from
 * the same recording; nothing extra is captured for this view.
 */
@customElement('updates-view')
export class UpdatesView extends LitElement {
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
      .pane {
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .pane.components {
        flex: 1;
        min-height: 0;
      }
      .pane.cycles {
        flex: 1;
        min-height: 0;
        border-top: 1px solid var(--lit-devtools-border);
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-3);
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
        flex-shrink: 0;
      }
      .head .count {
        margin-left: auto;
      }
      .scroll {
        flex: 1;
        overflow-y: auto;
      }
      .row {
        display: flex;
        align-items: baseline;
        gap: var(--lit-devtools-space-4);
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
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
      .tag {
        flex: 1;
        color: var(--lit-devtools-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .num {
        color: var(--lit-devtools-text-secondary);
        flex-shrink: 0;
        width: 72px;
        text-align: right;
      }
      .reasons {
        color: var(--lit-devtools-accent);
        flex-shrink: 0;
        max-width: 240px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cause {
        color: var(--lit-devtools-text-muted);
        flex-shrink: 0;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .time {
        color: var(--lit-devtools-text-muted);
        flex-shrink: 0;
        width: 64px;
        text-align: right;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--lit-devtools-space-4);
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-xs);
        padding: var(--lit-devtools-space-5);
        text-align: center;
      }
      .hint {
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
      }
      .error {
        padding: var(--lit-devtools-space-5);
        color: var(--lit-devtools-error);
        font-size: var(--lit-devtools-text-xs);
      }
      a {
        color: var(--lit-devtools-accent);
        text-decoration: none;
        cursor: pointer;
      }
      a:hover {
        text-decoration: underline;
      }
      .link {
        flex-shrink: 0;
        font-size: var(--lit-devtools-text-2xs);
      }
    `,
  ];

  @state() private _events: TimelineEvent[] = [];
  @state() private _error: string | null = null;
  /** Tag of the selected component row, or null for "none picked yet". */
  @state() private _selectedTag: string | null = null;

  private _storeOff: (() => void) | null = null;
  /** Derivation is memoised on the event array's identity: the store replaces
   *  the array rather than mutating it, and re-deriving the whole buffer on
   *  every unrelated state change would be wasteful. */
  private _derivedFrom: TimelineEvent[] | null = null;
  private _components: ComponentRollup[] = [];
  private _cycles: UpdateCycle[] = [];
  /** Element id from a deep link that has not matched a component yet. Held
   *  rather than dropped: a link can arrive before the recording it names has
   *  streamed in, which is the normal case for a freshly opened snapshot. */
  private _pendingId: number | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._storeOff = subscribeTimeline(() => this._readStore());
    this._readStore();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._storeOff?.();
    this._storeOff = null;
  }

  private _readStore(): void {
    this._events = getTimelineEvents();
    this._error = getTimelineError();
  }

  override willUpdate() {
    if (this._derivedFrom === this._events) return;
    this._derivedFrom = this._events;
    this._cycles = attributeInput(
      toUpdateCycles(toSpans(this._events)),
      this._events
    );
    this._components = rollup(this._cycles);
    // Keep the selection meaningful: a tag that no longer updated in the
    // retained window would leave the lower pane permanently empty.
    if (
      this._selectedTag !== null &&
      !this._components.some((c) => c.tagName === this._selectedTag)
    ) {
      this._selectedTag = null;
    }
    this._resolvePending();
  }

  private _resolvePending(): void {
    if (this._pendingId === null) return;
    const match = this._components.find((c) =>
      c.elementIds.includes(this._pendingId!)
    );
    if (match === undefined) return;
    this._pendingId = null;
    this._selectedTag = match.tagName;
  }

  /**
   * The element id the current selection stands for, for the panel shell's
   * deep link. A row is a component *tag*, so this reports the first instance
   * of it that updated — which selects the same row on the way back in.
   */
  get selectedId(): number | null {
    const selected = this._components.find(
      (c) => c.tagName === this._selectedTag
    );
    return selected?.elementIds[0] ?? null;
  }

  /** Selects the component row that the given element instance belongs to. */
  selectById(elementId: number): void {
    this._pendingId = elementId;
    this._resolvePending();
  }

  private _select(tagName: string): void {
    this._selectedTag = tagName;
    this._pendingId = null;
    this.dispatchEvent(new CustomEvent('selection-change'));
  }

  /** Ask the panel shell to open the Components tab on this element. */
  private _inspect(id: number) {
    this.dispatchEvent(
      new CustomEvent('inspect-element', {
        detail: {id},
        bubbles: true,
        composed: true,
      })
    );
  }

  override render() {
    if (this._error !== null) {
      return html`<div class="error">${this._error}</div>`;
    }
    if (this._components.length === 0) {
      return html`
        <div class="empty">
          <span>No component updates recorded.</span>
          <span class="hint">
            Press Record in the Timeline tab, with the Lit Lifecycle layer on,
            then interact with the page.
          </span>
        </div>
      `;
    }
    return html`
      <div class="pane components">
        <div class="head">
          <span>Component</span>
          <span class="count">${this._components.length} components</span>
        </div>
        <div class="scroll">
          ${repeat(
            this._components,
            (entry) => entry.tagName,
            (entry) => this._renderComponent(entry)
          )}
        </div>
      </div>
      ${this._renderCycles()}
    `;
  }

  private _renderComponent(entry: ComponentRollup) {
    const instances =
      entry.elementIds.length > 1 ? ` ×${entry.elementIds.length}` : '';
    return html`
      <div
        class="row ${this._selectedTag === entry.tagName ? 'selected' : ''}"
        @click=${() => this._select(entry.tagName)}
      >
        <span class="tag">&lt;${entry.tagName}&gt;${instances}</span>
        <span class="reasons"
          >${entry.reasons.map((r) => r.key).join(', ')}</span
        >
        <span class="num" title="Updates recorded">${entry.updates}×</span>
        <span class="num" title="Total time in performUpdate"
          >${formatMs(entry.totalMs)}</span
        >
        <span class="num" title="Slowest single update"
          >${formatMs(entry.maxMs)}</span
        >
      </div>
    `;
  }

  private _renderCycles() {
    if (this._selectedTag === null) {
      return html`
        <div class="pane cycles">
          <div class="empty">
            <span class="hint">
              Pick a component to see each of its updates and what changed.
            </span>
          </div>
        </div>
      `;
    }
    const cycles = this._cycles.filter((c) => c.tagName === this._selectedTag);
    const source = this._components.find(
      (c) => c.tagName === this._selectedTag
    )?.source;
    return html`
      <div class="pane cycles">
        <div class="head">
          <span>&lt;${this._selectedTag}&gt; updates</span>
          ${
            source
              ? html`<a
                  class="link"
                  title="Open this file in your editor"
                  @click=${() => openInEditor(source.file, source.line)}
                  >${source.file}:${source.line}</a
                >`
              : nothing
          }
          <span class="count">${cycles.length}</span>
        </div>
        <div class="scroll">
          ${repeat(
            cycles,
            (cycle) => cycle.key,
            (cycle) => html`
              <div class="row">
                <span class="time">${cycle.start.toFixed(1)}ms</span>
                <span class="num">${formatMs(cycle.duration)}</span>
                <span class="tag"
                  >${
                    cycle.changed.length > 0
                      ? cycle.changed.join(', ')
                      : html`<span class="hint">no changed properties</span>`
                  }</span
                >
                <span class="cause">${renderCause(cycle)}</span>
                <a
                  class="link"
                  title="Open this instance in the Components tab"
                  @click=${() => this._inspect(cycle.elementId)}
                  >#${cycle.elementId}</a
                >
              </div>
            `
          )}
        </div>
      </div>
    `;
  }
}

/** Lit updates are routinely sub-millisecond, so one decimal is not enough. */
const formatMs = (ms: number | undefined): string => {
  if (ms === undefined) return '—';
  return ms < 1 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(1)}ms`;
};

/**
 * "after click (412, 88)" — or nothing. An update with no cause within the
 * attribution window is a timer, a signal or a stray `requestUpdate()`, and
 * saying so wrongly would be worse than saying nothing.
 */
const renderCause = (cycle: UpdateCycle): string => {
  const {cause} = cycle;
  if (cause === undefined) return '';
  return `after ${cause.type}${cause.detail ? ` ${cause.detail}` : ''}`;
};

declare global {
  interface HTMLElementTagNameMap {
    'updates-view': UpdatesView;
  }
}
