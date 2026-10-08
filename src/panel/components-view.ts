import {LitElement, html, css, nothing, type TemplateResult} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/details/details.js';
import './wa-icons.js';
import '@awesome.me/webawesome/dist/components/split-panel/split-panel.js';
import type WaSplitPanel from '@awesome.me/webawesome/dist/components/split-panel/split-panel.js';
import {tokens} from '../lib/tokens.js';
import {
  ANATOMY_COLORS,
  type AnatomyElementRef,
  type InspectorAnatomy,
  type InspectorDetails,
  type InspectorExtra,
  type InspectorMessage,
  type InspectorTreeNode,
} from '../types/inspector.js';
import {
  describeHmrReason,
  type HmrIncompatibilityEvent,
} from '../types/hmr-incompatibility.js';
import type {HmrPatchEvent} from '../types/hmr-patch.js';
import {describeError, getMeta, litRpc} from './client.js';
import {ComponentsSession} from './components-session.js';
import {LocationController} from './location-controller.js';
import {PanelLocation} from './panel-location.js';
import {openInEditor} from './open-in-editor.js';
import {hostInfo, sendToPage, touchPageChannel} from './host.js';
import {overrides} from './settings-override.js';

/**
 * localStorage key remembering a paused live tree. Live is the default, so
 * only an explicit `'false'` turns it off.
 */
/** localStorage key remembering the details pane's width in pixels. */
const DETAILS_WIDTH_LS_KEY = 'lit-devtools-components-details-width';
const DETAILS_WIDTH_DEFAULT = 340;
const DETAILS_WIDTH_MIN = 220;

const readDetailsWidth = (): number => {
  try {
    const n = Number(localStorage.getItem(DETAILS_WIDTH_LS_KEY));
    return Number.isFinite(n) && n >= DETAILS_WIDTH_MIN
      ? Math.round(n)
      : DETAILS_WIDTH_DEFAULT;
  } catch {
    return DETAILS_WIDTH_DEFAULT;
  }
};

/**
 * The Components view: a hierarchical tree of the page's Lit elements (left)
 * and a details pane for the selected one (right). A tab of the DevTools panel
 * shell (\`lit-devtools-panel\`).
 *
 * It can't touch the page DOM directly (separate iframe), so it drives the
 * page's inspector runtime over devframe RPC: it calls the `inspect` action
 * with {@link InspectorCommand}s and receives {@link InspectorMessage}s
 * through the registered `inspector-message` client function. An overlay
 * inspect-pick arrives as a `pick` message; the view selects that node and
 * asks its host to switch to this tab.
 *
 * It also caches {@link HmrIncompatibilityEvent}s pushed over the
 * `hmr-incompatible` client function (primed from the node side's own cache
 * on connect, same as the tree) and renders them as a banner above the tree —
 * see "Cannot be patched in place" in the limitations docs for what these
 * mean. `hmr-count-change` bubbles the current count up to the panel shell so
 * it can badge the tab even while another tab is in front.
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
        gap: var(--lit-devtools-space-4);
        padding: var(--lit-devtools-space-3) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        background: var(--lit-devtools-surface-low);
        flex-shrink: 0;
      }
      .spacer {
        flex: 1;
      }
      wa-split-panel {
        flex: 1;
        min-height: 0;
        --min: ${DETAILS_WIDTH_MIN}px;
        --max: calc(100% - 200px);
      }
      .tree {
        height: 100%;
        overflow: auto;
        padding: var(--lit-devtools-space-2) 0;
        min-width: 0;
      }
      .empty {
        padding: var(--lit-devtools-space-6);
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-xs);
      }
      .empty code {
        font-family: var(--lit-devtools-font-mono);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        padding: 1px var(--lit-devtools-space-5);
        white-space: nowrap;
        cursor: pointer;
        font-family: var(--lit-devtools-font-mono);
        font-size: var(--lit-devtools-text-xs);
        line-height: 18px;
      }
      .row:hover {
        background: var(--lit-devtools-surface-hover);
      }
      .row.selected {
        background: var(--lit-devtools-surface-active);
      }
      .twisty {
        width: 12px;
        display: inline-flex;
        justify-content: center;
        color: var(--lit-devtools-text-muted);
        flex-shrink: 0;
      }
      .twisty wa-icon {
        font-size: 0.8em;
      }
      .tag {
        color: var(--lit-devtools-accent);
      }
      .tag .punct {
        color: var(--lit-devtools-text-muted);
      }
      .details {
        height: 100%;
        box-sizing: border-box;
        overflow: auto;
        padding: var(--lit-devtools-space-5) var(--lit-devtools-space-5);
        font-size: var(--lit-devtools-text-xs);
      }
      .details .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--lit-devtools-space-2);
        margin: 0 0 var(--lit-devtools-space-1);
      }
      .details h2 {
        font-size: var(--lit-devtools-text-xs);
        font-family: var(--lit-devtools-font-mono);
        color: var(--lit-devtools-accent);
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .src {
        max-width: 100%;
      }
      .src-text {
        display: block;
        font-family: var(--lit-devtools-font-mono);
        font-size: var(--lit-devtools-text-xs);
        color: var(--lit-devtools-text-muted);
        word-break: break-all;
      }
      .src::part(base) {
        padding-inline: 0;
        font-family: var(--lit-devtools-font-mono);
        word-break: break-all;
        white-space: normal;
        text-align: left;
      }
      section {
        margin-top: var(--lit-devtools-space-5);
      }
      section > .label {
        text-transform: uppercase;
        letter-spacing: var(--lit-devtools-tracking-caps);
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
        margin-bottom: var(--lit-devtools-space-2);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--lit-devtools-font-mono);
      }
      td {
        padding: 2px var(--lit-devtools-space-4) 2px 0;
        vertical-align: top;
        word-break: break-word;
      }
      td.name {
        color: var(--lit-devtools-text);
        white-space: nowrap;
      }
      td.val {
        color: var(--lit-devtools-warning);
        width: 100%;
      }
      .badge {
        margin-left: var(--lit-devtools-space-2);
        vertical-align: middle;
      }
      .flags {
        display: flex;
        gap: var(--lit-devtools-space-4);
        flex-wrap: wrap;
      }
      .swatch {
        display: inline-block;
        width: 8px;
        height: 8px;
        margin-right: var(--lit-devtools-space-2);
        border-radius: 2px;
        vertical-align: middle;
      }
      .slot-default {
        font-style: italic;
      }
      .el-ref {
        font-family: var(--lit-devtools-font-mono);
        color: var(--lit-devtools-accent);
        background: none;
        border: 0;
        padding: 0;
        margin-right: var(--lit-devtools-space-2);
        font-size: inherit;
        cursor: pointer;
      }
      .el-ref:disabled {
        color: var(--lit-devtools-text);
        cursor: default;
      }
      tr.orphan td {
        color: var(--lit-devtools-error);
      }
      .muted {
        color: var(--lit-devtools-text-muted);
      }
      .placeholder {
        color: var(--lit-devtools-text-muted);
        padding: var(--lit-devtools-space-8) 0;
        text-align: center;
      }
      .hmr-banner {
        flex-shrink: 0;
        background: var(--lit-devtools-error-soft);
      }
      wa-details.hmr-banner {
        --spacing: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
        border: 0;
        border-radius: 0;
        border-bottom: 1px solid var(--lit-devtools-border);
        color: var(--lit-devtools-error);
        font-size: var(--lit-devtools-text-xs);
      }
      .hmr-banner [slot='summary'] {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-3);
        font-weight: var(--lit-devtools-weight-semibold);
      }
      .hmr-list {
        list-style: none;
        margin: 0;
        padding: 0 var(--lit-devtools-space-5) var(--lit-devtools-space-3);
        max-height: 160px;
        overflow-y: auto;
      }
      .hmr-item {
        display: flex;
        align-items: baseline;
        gap: var(--lit-devtools-space-3);
        padding: var(--lit-devtools-space-2) 0;
        border-top: 1px solid var(--lit-devtools-border-subtle);
        font-size: var(--lit-devtools-text-2xs);
      }
      .hmr-item:first-child {
        border-top: 0;
      }
      .hmr-reason {
        flex: 1;
        min-width: 0;
        color: var(--lit-devtools-text);
      }
      .hmr-last-patch {
        flex-shrink: 0;
        padding: var(--lit-devtools-space-2) var(--lit-devtools-space-5);
        border-bottom: 1px solid var(--lit-devtools-border);
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-2xs);
      }
      .hmr-outcome,
      .hmr-time {
        flex-shrink: 0;
        color: var(--lit-devtools-text-muted);
        white-space: nowrap;
      }
    `,
  ];

  /**
   * The tree, the selection, Live, the picker and the HMR notices, and the
   * rules that keep the page in step with them. This element renders it.
   */
  private readonly _session = new ComponentsSession({
    send: sendToPage,
    storage: {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    },
    // A selection is part of "where the panel is": the shell writes it
    // into the URL, and a link that drops it would reopen the wrong view.
    onSelect: (id) => this.location.select('components', id),
    // Bring this tab to the front so the pick is visible. Bringing the dock
    // itself forward is the host's job: the node side activates it when it
    // forwards the pick (see lib/devframe/vite.ts).
    onPicked: () => this.location.setTab('components'),
  });

  /** Where the panel is; the shell hands its own in. */
  @property({attribute: false}) location = new PanelLocation();

  // A link that names an element: select it now. The tree may not hold it
  // yet; the session reveals it once a fresh tree arrives.
  protected readonly _locationController = new LocationController(this, () => {
    const id = this.location.requested('components');
    if (id === undefined) return;
    this._session.select(id);
    this.location.resolve('components', id);
  });
  /**
   * Whether the page has a picker to toggle, as `get-meta` reports it: the
   * source overlay under Vite (only with `sourceOverlay` on), the standalone
   * script's own under `lit-devtools dev`. A frozen snapshot has no page, and
   * a Pick button with no picker behind it would light up and do nothing.
   */
  @state() private _canPick = false;
  /** Whether a source location opens in the editor, as `get-meta` reports
   *  it; otherwise the location is shown as plain text. */
  @state() private _canOpen = false;
  /** A frozen snapshot: no page to reveal elements in or explain. */
  @state() private _snapshot = false;
  /** Mirror of the `flashUpdates` override; the Settings tab shows it too. */
  @state() private _flash = false;
  /** Draw the selected element's slots and parts on the page. */
  @state() private _anatomy = false;
  /** The id the page is drawing the anatomy of, `null` for none. */
  private _anatomyShown: number | null = null;
  /** Set when the devframe connection fails; rendered in place of the tree. */
  @state() private _error: string | null = null;
  /** Collapse state of the banner; the events themselves are never cleared. */
  @state() private _hmrExpanded = true;
  /** Details pane width in pixels, restored once; the split panel owns it
   *  after that and `_saveDetailsWidth` persists each drag. */
  private readonly _detailsWidth = readDetailsWidth();
  private _unsubscribeOverride: (() => void) | null = null;
  private _unsubscribeSession: (() => void) | null = null;
  private _reportedIncompatibilities: unknown = null;

  override connectedCallback() {
    super.connectedCallback();
    this._unsubscribeSession = this._session.subscribe(() => {
      this.requestUpdate();
      this._reportIncompatibilities();
    });
    this._flash = overrides.get().flashUpdates ?? false;
    this._unsubscribeOverride = overrides.subscribe((o) => {
      this._flash = o.flashUpdates ?? false;
    });
    void this._connect();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeOverride?.();
    this._unsubscribeOverride = null;
    this._unsubscribeSession?.();
    this._unsubscribeSession = null;
    this._session.dispose();
    this._syncAnatomy(null);
  }

  protected override updated(): void {
    this._syncAnatomy(
      this._anatomy && !this._snapshot ? this._session.selectedId : null
    );
  }

  /** Point the page's anatomy overlay at `id`, or clear it for `null`. */
  private _syncAnatomy(id: number | null): void {
    if (id === this._anatomyShown) return;
    this._anatomyShown = id;
    sendToPage({type: 'anatomy', id});
  }

  /**
   * Let the panel shell badge the Components tab even while another tab is
   * in front — the same cross-tab visibility an overlay pick gets by switching
   * tabs, but passive: no tab switch.
   */
  private _reportIncompatibilities(): void {
    const list = this._session.hmrIncompatibilities;
    if (list === this._reportedIncompatibilities) return;
    this._reportedIncompatibilities = list;
    this.dispatchEvent(
      new CustomEvent('hmr-count-change', {
        detail: {count: list.length},
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Count of cached HMR-incompatibility events; the panel shell's tab badge. */
  get hmrIncompatibilityCount(): number {
    return this._session.hmrIncompatibilities.length;
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  /**
   * Connects to the shared devframe client and registers the node → panel
   * `inspector-message` and `hmr-incompatible` pushes. Primes the tree and
   * the HMR-incompatibility list from the node side's caches (so a panel
   * opened after the page loaded isn't blank), then requests a fresh tree —
   * mirroring the old SSE `open` handler, which kicked off the first `tree`
   * request only once the stream was subscribed.
   */
  private async _connect(): Promise<void> {
    try {
      const rpc = await litRpc();
      rpc.rpc.register({
        name: 'inspector-message',
        type: 'event',
        handler: (message: InspectorMessage) => this._session.receive(message),
      });
      rpc.rpc.register({
        name: 'hmr-incompatible',
        type: 'event',
        handler: (event: HmrIncompatibilityEvent) =>
          this._session.hmrIncompatible(event),
      });
      rpc.rpc.register({
        name: 'hmr-patched',
        type: 'event',
        handler: (event: HmrPatchEvent) => this._session.hmrPatched(event),
      });
      void hostInfo().then((host) => {
        this._canPick = host.picker;
        this._canOpen = host.openInEditor;
        this._snapshot = host.snapshot;
      });
      void getMeta().then(
        (meta) => this._session.setRuntime(meta.runtime),
        () => {
          // No meta: the empty tree goes unexplained.
        }
      );
      const roots = await rpc.rpc.call('list-components');
      const hmrIncompatibilities = await rpc.rpc.call('hmr-incompatibilities');
      // A session dumped by an earlier version has no history baked in; the
      // patch line simply stays hidden.
      const hmrHistory = await rpc.rpc.call('hmr-history').then(
        (history) => history.entries,
        () => undefined
      );
      // The tree baked into a frozen session is all it has: `sendToPage` drops the
      // commands this sends, since asking the page would reject.
      this._session.connected({roots, hmrIncompatibilities, hmrHistory});
      if (this._session.live) touchPageChannel();
    } catch (err) {
      this._error = describeError(err);
    }
  }

  /**
   * Why the tree is empty, from the most specific cause the runtime's
   * announcement allows. A frozen snapshot has no runtime to ask about.
   */
  private _renderEmpty() {
    const runtime = this._snapshot ? null : this._session.runtime;
    if (runtime !== null && !runtime.ready) {
      return html`<div class="empty">
        The page runtime has not connected to this dev server. Open the page
        through this dev server and check that <code>timeline</code> is on (or
        <code>LIT_PLUGIN_TIMELINE=true</code>), then reload. If it stays empty,
        look for a failed script in the browser console.
      </div>`;
    }
    const duplicate =
      runtime === null
        ? undefined
        : Object.entries(runtime.litPackages).find(([, v]) => v.length > 1);
    if (duplicate !== undefined) {
      const [name, versions] = duplicate;
      return html`<div class="empty">
        More than one copy of lit is loaded (${name} ${versions.join(', ')}).
        Components registered against a different copy cannot be inspected or
        patched. Dedupe lit in your bundler with
        <code>resolve.dedupe: ['lit']</code>.
      </div>`;
    }
    if (runtime !== null && !runtime.topFrame) {
      return html`<div class="empty">
        The runtime is running inside an iframe, so this tree only shows that
        frame's components. Open the page that owns the components directly.
      </div>`;
    }
    return html`<div class="empty">No Lit components found on the page.</div>`;
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /** Another page took over (see the shell's `page-changed` listener). */
  pageChanged(): void {
    this._session.pageChanged();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private _togglePick(): void {
    this._session.togglePick();
  }

  private _toggleLive(): void {
    this._session.toggleLive();
    // Connect the lazy in-page channel so the page can see the panel leave.
    if (this._session.live) touchPageChannel();
  }

  /**
   * Flash-on-update is a settings override, not an inspector command: the
   * page runtime reads it at boot (so it survives reloads) and gets live
   * pushes, and the Settings tab mirrors the same switch.
   */
  private _toggleFlash(): void {
    overrides.set('flashUpdates', !this._flash);
  }

  private _toggleAnatomy(): void {
    this._anatomy = !this._anatomy;
  }

  /** Outline an element in the page; fires on every `mouseenter` in the tree. */
  private _highlight(id: number | null): void {
    sendToPage({type: 'highlight', id});
  }

  /** Scroll the selected element into view in the page. */
  private _reveal(): void {
    const id = this._session.details?.id;
    if (id !== undefined) sendToPage({type: 'reveal', id});
  }

  private _saveDetailsWidth(e: Event): void {
    const width = Math.round((e.target as WaSplitPanel).positionInPixels);
    if (!(width >= DETAILS_WIDTH_MIN)) return;
    try {
      localStorage.setItem(DETAILS_WIDTH_LS_KEY, String(width));
    } catch {
      // Storage unavailable: the width just won't be remembered.
    }
  }

  private _onHmrToggle(e: Event): void {
    // wa-show/wa-hide also bubble from nested wa-details; only ours counts.
    if (e.target !== e.currentTarget) return;
    this._hmrExpanded = (e.target as HTMLElement).hasAttribute('open');
  }

  private _openSource(): void {
    const src = this._session.details?.source;
    if (src === undefined) return;
    void openInEditor(src.file, src.line);
  }

  private _openCallSite(): void {
    const site = this._session.details?.callSite;
    if (site === undefined) return;
    void openInEditor(site.file, site.line, site.column);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  private _renderNode(node: InspectorTreeNode, depth: number): TemplateResult {
    const hasChildren = node.children.length > 0;
    const expanded = this._session.expanded.has(node.id);
    return html`
      <div
        class="row ${node.id === this._session.selectedId ? 'selected' : ''}"
        style="padding-left:${8 + depth * 14}px"
        @click=${() => this._session.select(node.id)}
        @mouseenter=${() => this._highlight(node.id)}
      >
        <span
          class="twisty"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._session.toggleExpand(node.id);
          }}
          >${
            hasChildren
              ? html`<wa-icon
                  name=${expanded ? 'caret-down' : 'caret-right'}
                ></wa-icon>`
              : nothing
          }</span
        >
        <span class="tag"
          ><span class="punct">&lt;</span>${node.tagName}<span class="punct"
            >&gt;</span
          ></span
        >
      </div>
      ${
        hasChildren && expanded
          ? node.children.map((c) => this._renderNode(c, depth + 1))
          : nothing
      }
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
                ${p.name}${
                  p.reflects
                    ? html`<wa-badge
                        class="badge"
                        variant="neutral"
                        appearance="outlined"
                        data-tip="Reflects to an attribute"
                        >${
                          typeof p.attribute === 'string' ? p.attribute : 'attr'
                        }</wa-badge
                      >`
                    : nothing
                }
              </td>
              <td class="val">${p.value}</td>
            </tr>
          `
        )}
      </table>
    `;
  }

  private _renderExtraTable(extras: InspectorExtra[]): TemplateResult {
    return html`
      <table>
        ${extras.map(
          (e) => html`
            <tr>
              <td class="name" title=${e.type}>
                ${e.name}<wa-badge
                  class="badge"
                  variant="neutral"
                  appearance="outlined"
                  >${e.kind}</wa-badge
                >${
                  e.status !== undefined
                    ? html`<wa-badge
                        class="badge"
                        variant="neutral"
                        appearance="outlined"
                        >${e.status}</wa-badge
                      >`
                    : nothing
                }
              </td>
              <td class="val">${e.value}</td>
            </tr>
          `
        )}
      </table>
    `;
  }

  /** An element in a slot or orphan row; inspectable ones select on click. */
  private _renderElementRef(ref: AnatomyElementRef): TemplateResult {
    const {id} = ref;
    return html`<button
      class="el-ref"
      ?disabled=${id === undefined}
      @click=${() => id !== undefined && this._session.select(id)}
      @mouseenter=${() => id !== undefined && this._highlight(id)}
      @mouseleave=${() => this._highlight(null)}
    >
      &lt;${ref.tagName}&gt;
    </button>`;
  }

  private _renderSlotBadge(label: string, tip: string): TemplateResult {
    return html`<wa-badge
      class="badge"
      variant="neutral"
      appearance="outlined"
      data-tip=${tip}
      >${label}</wa-badge
    >`;
  }

  /**
   * Slots and parts, coloured like their regions in the page's anatomy
   * overlay: slot `i` takes colour `i`, and parts continue after the slots.
   */
  private _renderAnatomy(a: InspectorAnatomy): TemplateResult {
    const color = (i: number) => ANATOMY_COLORS[i % ANATOMY_COLORS.length];
    const showSlots =
      a.slots.length > 0 || a.orphans.length > 0 || a.orphanText > 0;
    return html`
      ${
        showSlots
          ? html`<section>
              <div class="label">Slots</div>
              <table>
                ${a.slots.map(
                  (s, i) => html`<tr>
                    <td class="name">
                      <span class="swatch" style="background:${color(i)}"></span
                      >${
                        s.name === ''
                          ? html`<span class="slot-default">default</span>`
                          : s.name
                      }${
                        s.status === 'assigned'
                          ? nothing
                          : this._renderSlotBadge(
                              s.status,
                              s.status === 'fallback'
                                ? 'Nothing is assigned, so the slot shows its own content'
                                : 'Nothing is assigned and the slot has no fallback content'
                            )
                      }${
                        s.forwarded
                          ? this._renderSlotBadge(
                              'forwarded',
                              'The content comes through a slot of an enclosing component'
                            )
                          : nothing
                      }${
                        s.duplicate
                          ? this._renderSlotBadge(
                              'duplicate',
                              'An earlier slot has the same name, so this one never receives content'
                            )
                          : nothing
                      }
                    </td>
                    <td class="val">
                      ${s.elements.map((e) => this._renderElementRef(e))}${
                        s.moreElements > 0
                          ? html`<span class="muted">+${s.moreElements}</span>`
                          : nothing
                      }${
                        s.textNodes > 0
                          ? html`<span class="muted">${s.textNodes} text</span>`
                          : nothing
                      }
                    </td>
                  </tr>`
                )}
                ${a.orphans.map(
                  (o) => html`<tr
                    class="orphan"
                    data-tip="No slot takes this child, so it is not rendered"
                  >
                    <td class="name">
                      ${o.slot === '' ? 'no default slot' : `slot="${o.slot}"`}
                    </td>
                    <td class="val">
                      ${this._renderElementRef(o)}<span class="muted"
                        >not rendered</span
                      >
                    </td>
                  </tr>`
                )}
                ${
                  a.orphanText > 0
                    ? html`<tr class="orphan">
                        <td class="name">no default slot</td>
                        <td class="val">${a.orphanText} text, not rendered</td>
                      </tr>`
                    : nothing
                }
              </table>
            </section>`
          : nothing
      }
      ${
        a.parts.length > 0
          ? html`<section>
              <div class="label">Parts</div>
              <table>
                ${a.parts.map(
                  (p, j) => html`<tr>
                    <td class="name">
                      <span
                        class="swatch"
                        style="background:${color(a.slots.length + j)}"
                      ></span
                      >${p.names.join(' ')}
                    </td>
                    <td class="val">&lt;${p.tagName}&gt;</td>
                  </tr>`
                )}
              </table>
            </section>`
          : nothing
      }
    `;
  }

  private _renderFlag(label: string, on: boolean): TemplateResult {
    return html`<wa-badge
      class="flag ${on ? 'on' : ''}"
      variant=${on ? 'brand' : 'neutral'}
      appearance=${on ? 'filled' : 'outlined'}
      >${label}</wa-badge
    >`;
  }

  private _renderDetails(): TemplateResult {
    const {details: d, gone, selectedId} = this._session;
    if (d === null) {
      let message: string;
      if (gone) {
        message = 'This element is no longer in the page.';
      } else if (selectedId === null) {
        message = 'Select a component to inspect.';
      } else {
        message = 'Loading…';
      }
      return html`<div class="placeholder">${message}</div>`;
    }
    const props = d.properties.filter((p) => !p.state);
    const stateProps = d.properties.filter((p) => p.state);
    const extras = d.extras ?? [];
    return html`
      <div class="head">
        <h2>&lt;${d.tagName}&gt;</h2>
        ${
          this._snapshot
            ? nothing
            : html`<wa-button
                class="reveal"
                appearance="plain"
                size="small"
                data-tip="Scroll this element into view on the page"
                aria-label="Scroll into view"
                @click=${this._reveal}
              >
                <wa-icon name="target"></wa-icon>
              </wa-button>`
        }
      </div>
      ${
        d.source === undefined
          ? nothing
          : this._canOpen
            ? html`<wa-button
                class="src"
                appearance="plain"
                size="small"
                data-tip="Open this file in your editor"
                @click=${this._openSource}
              >
                ${d.source.file}:${d.source.line}
                <wa-icon slot="end" name="arrow-square-out"></wa-icon>
              </wa-button>`
            : // No editor on this host: still worth knowing where it lives.
              html`<span class="src src-text"
                >${d.source.file}:${d.source.line}</span
              >`
      }
      ${
        d.callSite === undefined
          ? nothing
          : this._canOpen
            ? html`<wa-button
                class="src call-site"
                appearance="plain"
                size="small"
                data-tip="Open the template that renders this element"
                @click=${this._openCallSite}
              >
                Rendered at ${d.callSite.file}:${d.callSite.line}
                <wa-icon slot="end" name="arrow-square-out"></wa-icon>
              </wa-button>`
            : html`<span class="src src-text call-site"
                >Rendered at ${d.callSite.file}:${d.callSite.line}</span
              >`
      }
      <section>
        <div class="flags">
          ${this._renderFlag('updated', d.flags.hasUpdated)}
          ${this._renderFlag('update pending', d.flags.isUpdatePending)}
          ${this._renderFlag('shadow root', d.flags.hasShadowRoot)}
          ${
            d.anatomy?.renderRoot === 'light'
              ? this._renderFlag('light DOM', true)
              : nothing
          }
          ${
            d.anatomy?.mode === 'closed'
              ? this._renderFlag('closed', true)
              : nothing
          }
          ${
            d.anatomy?.delegatesFocus === true
              ? this._renderFlag('delegatesFocus', true)
              : nothing
          }
        </div>
      </section>
      ${d.anatomy === undefined ? nothing : this._renderAnatomy(d.anatomy)}
      ${
        props.length > 0
          ? html`<section>
              <div class="label">Properties</div>
              ${this._renderPropTable(props)}
            </section>`
          : nothing
      }
      ${
        stateProps.length > 0
          ? html`<section>
              <div class="label">State</div>
              ${this._renderPropTable(stateProps)}
            </section>`
          : nothing
      }
      ${
        d.attributes.length > 0
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
          : nothing
      }
      ${
        extras.length > 0
          ? html`<section>
              <div class="label">Instance</div>
              ${this._renderExtraTable(extras)}
            </section>`
          : nothing
      }
    `;
  }

  /** One line for the latest patch that landed; hidden until there is one. */
  private _renderLastPatch(): TemplateResult | typeof nothing {
    const p = this._session.lastPatch;
    if (p === null) return nothing;
    return html`<div class="hmr-last-patch">
      Patched &lt;${p.tagName}&gt; ×${p.instances} in ${p.durationMs} ms
      (childState: ${p.childState})
      <span class="hmr-time">${formatRelativeTime(p.at)}</span>
    </div>`;
  }

  /**
   * Collapsible banner listing components that couldn't be hot-patched in
   * place, most recent first. Rendered only when there's at least one —
   * see `hmrIncompatibilityCount` for the tab-strip badge that covers the
   * case where the developer is parked on another tab.
   */
  private _renderHmrBanner(): TemplateResult | typeof nothing {
    if (this._session.hmrIncompatibilities.length === 0) return nothing;
    return html`
      <wa-details
        class="hmr-banner"
        appearance="plain"
        ?open=${this._hmrExpanded}
        @wa-show=${this._onHmrToggle}
        @wa-hide=${this._onHmrToggle}
      >
        <span slot="summary">
          <span class="hmr-title">HMR issues</span>
          <wa-badge class="hmr-count" variant="danger" pill
            >${this._session.hmrIncompatibilities.length}</wa-badge
          >
        </span>
        <wa-icon slot="expand-icon" name="caret-right"></wa-icon>
        <wa-icon slot="collapse-icon" name="caret-down"></wa-icon>
        ${
          this._hmrExpanded
            ? html`
                <ul class="hmr-list">
                  ${[...this._session.hmrIncompatibilities].reverse().map(
                    (e) => html`
                      <li class="hmr-item">
                        <span class="tag"
                          ><span class="punct">&lt;</span>${e.tagName}<span
                            class="punct"
                            >&gt;</span
                          ></span
                        >
                        <span class="hmr-reason"
                          >${describeHmrReason(e.reason)}</span
                        >
                        ${
                          e.action !== 'none'
                            ? html`<span class="hmr-outcome"
                                >${
                                  e.action === 'reload'
                                    ? 'reloaded'
                                    : 'warned only'
                                }</span
                              >`
                            : nothing
                        }
                        <span class="hmr-time"
                          >${formatRelativeTime(e.time)}</span
                        >
                      </li>
                    `
                  )}
                </ul>
              `
            : nothing
        }
      </wa-details>
    `;
  }

  private _renderToggle(
    kind: string,
    on: boolean,
    tip: string,
    onClick: () => void,
    icon: TemplateResult,
    label: string
  ): TemplateResult {
    return html`<wa-button
      class="${kind} ${on ? 'active' : ''}"
      size="small"
      variant=${on ? 'brand' : 'neutral'}
      appearance=${on ? 'filled' : 'outlined'}
      data-tip=${tip}
      @click=${onClick}
    >
      ${icon} ${label}
    </wa-button>`;
  }

  override render() {
    return html`
      <div class="toolbar">
        ${
          this._canPick
            ? this._renderToggle(
                'pick',
                this._session.picking,
                'Pick an element on the page (Meta+Shift+E)',
                this._togglePick,
                html`<wa-icon slot="start" name="crosshair"></wa-icon>`,
                'Pick'
              )
            : nothing
        }
        <span class="spacer"></span>
        ${this._renderToggle(
          'live',
          this._session.live,
          this._session.live
            ? 'Pause: stop updating the tree as the page changes'
            : 'Resume updating the tree as the page changes',
          this._toggleLive,
          html`<wa-icon
            slot="start"
            name=${this._session.live ? 'eye' : 'eye-slash'}
          ></wa-icon>`,
          'Live'
        )}
        ${this._renderToggle(
          'flash',
          this._flash,
          'Flash elements on the page when they update',
          this._toggleFlash,
          html`<wa-icon slot="start" name="lightning"></wa-icon>`,
          'Flash'
        )}
        ${
          this._snapshot
            ? nothing
            : this._renderToggle(
                'anatomy',
                this._anatomy,
                "Draw the selected element's slots and parts on the page",
                this._toggleAnatomy,
                html`<wa-icon slot="start" name="bounding-box"></wa-icon>`,
                'Anatomy'
              )
        }
      </div>
      ${this._renderHmrBanner()}${this._renderLastPatch()}
      <wa-split-panel
        primary="end"
        position-in-pixels=${this._detailsWidth}
        @wa-reposition=${this._saveDetailsWidth}
      >
        <div
          slot="start"
          class="tree"
          @mouseleave=${() => this._highlight(null)}
        >
          ${
            this._error !== null
              ? html`<div class="empty">${this._error}</div>`
              : this._session.roots.length === 0
                ? this._renderEmpty()
                : this._session.roots.map((n) => this._renderNode(n, 0))
          }
        </div>
        <div slot="end" class="details">${this._renderDetails()}</div>
      </wa-split-panel>
    `;
  }
}

/**
 * Coarse relative time for an {@link HmrIncompatibilityEvent}'s `Date.now()`
 * timestamp (there is no live clock tick in this view — good enough for a
 * banner of rare, one-off events, unlike the timeline's precise `ms` display).
 */
const formatRelativeTime = (time: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
};

declare global {
  interface HTMLElementTagNameMap {
    'components-view': ComponentsView;
  }
}
