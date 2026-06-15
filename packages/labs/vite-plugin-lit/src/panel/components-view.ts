/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {LitElement, html, css, nothing, type TemplateResult} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {tokens} from '../lib/tokens.js';
import {
  INSPECT_PATH,
  INSPECT_SSE_EVENT,
  type InspectorCommand,
  type InspectorDetails,
  type InspectorMessage,
  type InspectorTreeNode,
} from '../types/inspector.js';

/** localStorage key remembering the opt-in live-tree toggle. */
const LIVE_LS_KEY = 'lit-devtools-components-live';

/**
 * The Components view: a hierarchical tree of the page's Lit elements (left)
 * and a details pane for the selected one (right). A tab of the DevTools panel
 * shell (`timeline-app`).
 *
 * It can't touch the page DOM directly (separate iframe), so it drives the
 * page's inspector runtime over the transport: it POSTs {@link InspectorCommand}s
 * to {@link INSPECT_PATH} and receives {@link InspectorMessage}s on the shared
 * SSE stream's `inspect` event. An overlay inspect-pick arrives as a `pick`
 * message; the view selects that node and asks its host to switch to this tab.
 */
@customElement('components-view')
export class ComponentsView extends LitElement {
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
        gap: var(--space-4);
        padding: var(--space-3) var(--space-5);
        border-bottom: 1px solid var(--border);
        background: var(--surface-low);
        flex-shrink: 0;
      }
      .spacer {
        flex: 1;
      }
      button {
        padding: var(--space-2) var(--space-5);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border);
        background: var(--surface-elevated);
        color: var(--text);
        font-size: var(--text-2xs);
        cursor: pointer;
      }
      button:hover {
        background: var(--surface-hover);
        border-color: var(--border-strong);
      }
      button.pick.active,
      button.live.active {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
      }
      button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      .tree {
        flex: 1;
        overflow: auto;
        padding: var(--space-2) 0;
        min-width: 0;
      }
      .empty {
        padding: var(--space-6);
        color: var(--text-muted);
        font-size: var(--text-xs);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 1px var(--space-5);
        white-space: nowrap;
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        line-height: 18px;
      }
      .row:hover {
        background: var(--surface-hover);
      }
      .row.selected {
        background: var(--surface-active);
      }
      .twisty {
        width: 12px;
        text-align: center;
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .twisty.leaf {
        visibility: hidden;
      }
      .tag {
        color: var(--accent);
      }
      .tag .punct {
        color: var(--text-muted);
      }
      .details {
        width: 340px;
        flex-shrink: 0;
        border-left: 1px solid var(--border);
        overflow: auto;
        padding: var(--space-5) var(--space-5);
        font-size: var(--text-xs);
      }
      .details h2 {
        font-size: var(--text-xs);
        font-family: var(--font-mono);
        color: var(--accent);
        margin: 0 0 var(--space-1);
      }
      .src {
        background: none;
        border: 0;
        padding: 0;
        color: var(--text-link);
        font-size: var(--text-2xs);
        cursor: pointer;
        text-decoration: underline;
        word-break: break-all;
        text-align: left;
      }
      section {
        margin-top: var(--space-5);
      }
      section > .label {
        text-transform: uppercase;
        letter-spacing: var(--tracking-caps);
        font-size: var(--text-2xs);
        color: var(--text-muted);
        margin-bottom: var(--space-2);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-mono);
      }
      td {
        padding: 2px var(--space-4) 2px 0;
        vertical-align: top;
        word-break: break-word;
      }
      td.name {
        color: var(--text);
        white-space: nowrap;
      }
      td.val {
        color: var(--warning);
        width: 100%;
      }
      .badge {
        display: inline-block;
        margin-left: var(--space-2);
        padding: 0 var(--space-2);
        border-radius: var(--radius-xs);
        font-size: 9px;
        background: var(--surface-elevated);
        color: var(--text-secondary);
        vertical-align: middle;
      }
      .flags {
        display: flex;
        gap: var(--space-4);
        flex-wrap: wrap;
      }
      .flag {
        padding: 1px var(--space-4);
        border-radius: var(--radius-xs);
        background: var(--surface-elevated);
        color: var(--text-secondary);
        font-size: var(--text-2xs);
      }
      .flag.on {
        background: var(--accent-soft);
        color: var(--accent);
      }
      .placeholder {
        color: var(--text-muted);
        padding: var(--space-8) 0;
        text-align: center;
      }
    `,
  ];

  @state() private _roots: InspectorTreeNode[] = [];
  @state() private _selectedId: number | null = null;
  @state() private _details: InspectorDetails | null = null;
  /** True when the selected element is no longer in the page (removed / GC'd). */
  @state() private _gone = false;
  @state() private _expanded = new Set<number>();
  @state() private _picking = false;
  /** Opt-in live tree (MutationObserver in the page); persisted, default off. */
  @state() private _live = false;

  private _es: EventSource | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._live = localStorage.getItem(LIVE_LS_KEY) === 'true';
    this._es = new EventSource('/__lit-devtools-events');
    this._es.addEventListener(INSPECT_SSE_EVENT, this._onMessage);
    // Request only once the stream is open — a command sent before we're
    // subscribed would have its reply broadcast before we could receive it.
    this._es.addEventListener('open', this._onOpen);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._es?.removeEventListener(INSPECT_SSE_EVENT, this._onMessage);
    this._es?.removeEventListener('open', this._onOpen);
    this._es?.close();
    this._es = null;
    this._post({type: 'watch', id: null});
    if (this._live) this._post({type: 'observe', enabled: false});
  }

  /** Refresh the tree (and re-arm watch / live mode) once the SSE connects. */
  private _onOpen = (): void => {
    this._post({type: 'tree'});
    if (this._selectedId !== null) {
      this._post({type: 'watch', id: this._selectedId});
    }
    if (this._live) this._post({type: 'observe', enabled: true});
  };

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  private _post(cmd: InspectorCommand): void {
    fetch(INSPECT_PATH, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(cmd),
    }).catch(() => {
      // dev tool — ignore network errors
    });
  }

  private _onMessage = (e: Event): void => {
    let msg: InspectorMessage;
    try {
      msg = JSON.parse((e as MessageEvent<string>).data) as InspectorMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        // Runtime (re)connected — refresh the tree and re-arm any selection.
        this._post({type: 'tree'});
        if (this._selectedId !== null) {
          this._post({type: 'watch', id: this._selectedId});
        }
        break;
      case 'tree':
        this._roots = msg.roots;
        break;
      case 'details':
        if (msg.details.id === this._selectedId) {
          this._details = msg.details;
          this._gone = false;
        }
        break;
      case 'gone':
        if (msg.id === this._selectedId) {
          this._details = null;
          this._gone = true;
        }
        break;
      case 'pick':
        this._picking = false;
        this._select(msg.id);
        // Bring this tab to the front so the pick is visible.
        this.dispatchEvent(
          new CustomEvent('inspector-activate', {bubbles: true, composed: true})
        );
        break;
    }
  };

  // ---------------------------------------------------------------------------
  // Selection / expansion
  // ---------------------------------------------------------------------------

  /**
   * Select an element by id from outside (e.g. a timeline event's "inspect"
   * link). Same as a tree click; the host is responsible for switching tabs.
   */
  selectById(id: number): void {
    this._select(id);
  }

  private _select(id: number): void {
    if (this._selectedId === id) return;
    if (this._selectedId !== null) {
      this._post({type: 'watch', id: null});
    }
    this._selectedId = id;
    this._details = null;
    this._gone = false;
    this._revealAncestors(id);
    this._post({type: 'tree'}); // refresh in case the picked node is new
    this._post({type: 'details', id});
    this._post({type: 'watch', id});
  }

  /** Expand every ancestor of `id` so the selected node is visible. */
  private _revealAncestors(id: number): void {
    const path = findAncestors(this._roots, id);
    if (path === null) return;
    const next = new Set(this._expanded);
    for (const ancestorId of path) next.add(ancestorId);
    this._expanded = next;
  }

  private _toggleExpand(id: number): void {
    const next = new Set(this._expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expanded = next;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private _refresh(): void {
    this._post({type: 'tree'});
    if (this._selectedId !== null) {
      this._post({type: 'details', id: this._selectedId});
    }
  }

  private _togglePick(): void {
    this._picking = !this._picking;
    this._post({type: 'pick'});
  }

  private _toggleLive(): void {
    this._live = !this._live;
    try {
      localStorage.setItem(LIVE_LS_KEY, String(this._live));
    } catch {
      // ignore (private/storage unavailable)
    }
    this._post({type: 'observe', enabled: this._live});
    // Leaving live mode, pull one fresh tree so it doesn't go stale silently.
    if (!this._live) this._post({type: 'tree'});
  }

  private _highlight(id: number | null): void {
    this._post({type: 'highlight', id});
  }

  private _openSource(): void {
    const src = this._details?.source;
    if (src === undefined) return;
    const params = new URLSearchParams({
      file: src.file,
      line: String(src.line),
    });
    fetch(`/__lit-open-in-editor?${params.toString()}`).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  private _renderNode(node: InspectorTreeNode, depth: number): TemplateResult {
    const hasChildren = node.children.length > 0;
    const expanded = this._expanded.has(node.id);
    return html`
      <div
        class="row ${node.id === this._selectedId ? 'selected' : ''}"
        style="padding-left:${8 + depth * 14}px"
        @click=${() => this._select(node.id)}
        @mouseenter=${() => this._highlight(node.id)}
      >
        <span
          class="twisty ${hasChildren ? '' : 'leaf'}"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._toggleExpand(node.id);
          }}
          >${hasChildren ? (expanded ? '▾' : '▸') : '•'}</span
        >
        <span class="tag"
          ><span class="punct">&lt;</span>${node.tagName}<span class="punct"
            >&gt;</span
          ></span
        >
      </div>
      ${hasChildren && expanded
        ? node.children.map((c) => this._renderNode(c, depth + 1))
        : nothing}
    `;
  }

  private _renderPropTable(
    props: InspectorDetails['properties']
  ): TemplateResult {
    return html`
      <table>
        ${props.map(
          (p) => html`
            <tr>
              <td class="name">
                ${p.name}${p.reflects
                  ? html`<span class="badge" title="reflects to attribute"
                      >${typeof p.attribute === 'string'
                        ? p.attribute
                        : 'attr'}</span
                    >`
                  : nothing}
              </td>
              <td class="val">${p.value}</td>
            </tr>
          `
        )}
      </table>
    `;
  }

  private _renderDetails(): TemplateResult {
    const d = this._details;
    if (d === null) {
      let message: string;
      if (this._gone) {
        message = 'This element is no longer in the page.';
      } else if (this._selectedId === null) {
        message = 'Select a component to inspect.';
      } else {
        message = 'Loading…';
      }
      return html`<div class="placeholder">${message}</div>`;
    }
    const props = d.properties.filter((p) => !p.state);
    const stateProps = d.properties.filter((p) => p.state);
    return html`
      <h2>&lt;${d.tagName}&gt;</h2>
      ${d.source !== undefined
        ? html`<button class="src" @click=${this._openSource}>
            ${d.source.file}:${d.source.line}
          </button>`
        : nothing}
      <section>
        <div class="flags">
          <span class="flag ${d.flags.hasUpdated ? 'on' : ''}">updated</span>
          <span class="flag ${d.flags.isUpdatePending ? 'on' : ''}"
            >update pending</span
          >
          <span class="flag ${d.flags.hasShadowRoot ? 'on' : ''}"
            >shadow root</span
          >
        </div>
      </section>
      ${props.length > 0
        ? html`<section>
            <div class="label">Properties</div>
            ${this._renderPropTable(props)}
          </section>`
        : nothing}
      ${stateProps.length > 0
        ? html`<section>
            <div class="label">State</div>
            ${this._renderPropTable(stateProps)}
          </section>`
        : nothing}
      ${d.attributes.length > 0
        ? html`<section>
            <div class="label">Attributes</div>
            <table>
              ${d.attributes.map(
                (a) =>
                  html`<tr>
                    <td class="name">${a.name}</td>
                    <td class="val">${a.value}</td>
                  </tr>`
              )}
            </table>
          </section>`
        : nothing}
    `;
  }

  override render() {
    return html`
      <div class="toolbar">
        <button
          class="pick ${this._picking ? 'active' : ''}"
          title="Pick an element on the page (Ctrl+Shift+E)"
          @click=${this._togglePick}
        >
          ⌖ Pick
        </button>
        <span class="spacer"></span>
        <button
          class="live ${this._live ? 'active' : ''}"
          title="Update the tree automatically as the page changes"
          @click=${this._toggleLive}
        >
          ${this._live ? '● Live' : '○ Live'}
        </button>
        <button @click=${this._refresh} ?disabled=${this._live}>Refresh</button>
      </div>
      <div class="body">
        <div class="tree" @mouseleave=${() => this._highlight(null)}>
          ${this._roots.length === 0
            ? html`<div class="empty">
                No Lit components found on the page.
              </div>`
            : this._roots.map((n) => this._renderNode(n, 0))}
        </div>
        <div class="details">${this._renderDetails()}</div>
      </div>
    `;
  }
}

/**
 * Returns the ids of every ancestor of `id` (nearest last), or `null` if `id`
 * isn't in the tree. The target id itself is not included.
 */
const findAncestors = (
  nodes: InspectorTreeNode[],
  id: number,
  trail: number[] = []
): number[] | null => {
  for (const node of nodes) {
    if (node.id === id) return trail;
    const found = findAncestors(node.children, id, [...trail, node.id]);
    if (found !== null) return found;
  }
  return null;
};

declare global {
  interface HTMLElementTagNameMap {
    'components-view': ComponentsView;
  }
}
