import {LitElement, html, css, nothing, type TemplateResult} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/details/details.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import './wa-icons.js';
import '@awesome.me/webawesome/dist/components/split-panel/split-panel.js';
import type WaInput from '@awesome.me/webawesome/dist/components/input/input.js';
import type WaSplitPanel from '@awesome.me/webawesome/dist/components/split-panel/split-panel.js';
import {tokens} from '../lib/tokens.js';
import {
  ANATOMY_COLORS,
  type AnatomyElementRef,
  type AnatomyFocus,
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
import {formatValue} from './value-format.js';

/**
 * localStorage key remembering a paused live tree. Live is the default, so
 * only an explicit `'false'` turns it off.
 */
/** localStorage key remembering the details pane's width in pixels. */
const DETAILS_WIDTH_LS_KEY = 'lit-devtools-components-details-width';
const DETAILS_WIDTH_DEFAULT = 340;
const DETAILS_WIDTH_MIN = 220;

/** localStorage key listing the details sections the user folded. */
const COLLAPSED_LS_KEY = 'lit-devtools-components-collapsed';

const readCollapsed = (): ReadonlySet<string> => {
  try {
    const list: unknown = JSON.parse(
      localStorage.getItem(COLLAPSED_LS_KEY) ?? '[]'
    );
    return new Set(
      Array.isArray(list)
        ? list.filter((x): x is string => typeof x === 'string')
        : []
    );
  } catch {
    return new Set();
  }
};

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

/** Values longer than this take a full line under their name. */
const WIDE_VALUE = 32;

/**
 * Which anatomy rows a filter keeps, index for index. A slot matches on its
 * name (`default` for the unnamed one) or an assigned element's tag; a part
 * on its names or tag.
 */
const anatomyMatches = (
  a: InspectorAnatomy,
  matches: (...texts: string[]) => boolean
) => ({
  slots: a.slots.map((s) =>
    matches(
      s.name === '' ? 'default' : s.name,
      ...s.elements.map((e) => e.tagName)
    )
  ),
  orphans: a.orphans.map((o) =>
    matches(o.slot === '' ? 'no default slot' : `slot="${o.slot}"`, o.tagName)
  ),
  orphanText: a.orphanText > 0 && matches('no default slot'),
  parts: a.parts.map((p) => matches(...p.names, p.tagName)),
});

/** A serialized preview as coloured spans, re-flowed when long. */
const renderCode = (value: string): TemplateResult[] =>
  formatValue(value).map((t) =>
    t.kind === 'text'
      ? html`${t.text}`
      : html`<span class="t-${t.kind}">${t.text}</span>`
  );

/** Types the value's own spelling already shows, so no tag is needed. */
const SELF_EVIDENT_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'undefined',
  'null',
  'function',
  'object',
]);

/**
 * A muted type tag after a name, for values whose preview does not already
 * say what they are: `Array(3)` for `[1, 2, 3]`, but nothing for `"a"` or
 * `MyClass {…}`.
 */
const typeLabel = (
  type: string,
  value: string
): TemplateResult | typeof nothing =>
  SELF_EVIDENT_TYPES.has(type) || value.startsWith(type)
    ? nothing
    : html`<span class="type">${type}</span>`;

/**
 * The render root in a few words: `shadow, open, delegatesFocus`, or
 * `light DOM`. Undefined when the element has no render root yet.
 */
const describeRoot = (d: InspectorDetails): string | undefined => {
  const a = d.anatomy;
  if (a === undefined) return d.flags.hasShadowRoot ? 'shadow' : undefined;
  if (a.renderRoot === 'light') return 'light DOM';
  return ['shadow', a.mode, a.delegatesFocus === true ? 'delegatesFocus' : '']
    .filter(Boolean)
    .join(', ');
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
        gap: var(--lit-devtools-space-3);
        margin: 0 0 var(--lit-devtools-space-3);
      }
      .details h2 {
        font-size: var(--lit-devtools-text-sm);
        font-family: var(--lit-devtools-font-mono);
        color: var(--lit-devtools-accent);
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .details .head .reveal {
        margin-left: auto;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        flex-shrink: 0;
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
        white-space: nowrap;
      }
      .status::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .name > .status {
        margin-left: var(--lit-devtools-space-3);
      }
      .status.task-pending {
        color: var(--lit-devtools-warning);
      }
      .status.task-complete {
        color: var(--lit-devtools-success);
      }
      .status.task-error {
        color: var(--lit-devtools-error);
      }
      .status.pending {
        color: var(--lit-devtools-warning);
      }
      .meta {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        column-gap: var(--lit-devtools-space-4);
        row-gap: var(--lit-devtools-space-1);
        margin: 0;
        font-family: var(--lit-devtools-font-mono);
      }
      .meta dt {
        color: var(--lit-devtools-text-muted);
      }
      .meta dd {
        margin: 0;
        min-width: 0;
        color: var(--lit-devtools-text-secondary);
        overflow-wrap: anywhere;
      }
      .link {
        font: inherit;
        color: var(--lit-devtools-text-link);
        background: none;
        border: 0;
        padding: 0;
        cursor: pointer;
        text-align: left;
        overflow-wrap: anywhere;
      }
      .link:hover {
        text-decoration: underline;
      }
      .link:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
        outline-offset: 1px;
        border-radius: 2px;
      }
      .link wa-icon {
        margin-left: var(--lit-devtools-space-1);
        vertical-align: -0.125em;
      }
      .section {
        margin-top: var(--lit-devtools-space-5);
      }
      .section > summary {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-2);
        margin-bottom: var(--lit-devtools-space-2);
        list-style: none;
        cursor: pointer;
        user-select: none;
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
      }
      .section > summary::-webkit-details-marker {
        display: none;
      }
      .section > summary:hover {
        color: var(--lit-devtools-text-secondary);
      }
      .section > summary:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
        outline-offset: 2px;
        border-radius: 2px;
      }
      .section:not([open]) > summary {
        margin-bottom: 0;
      }
      summary .label {
        text-transform: uppercase;
        letter-spacing: var(--lit-devtools-tracking-caps);
      }
      summary .count {
        font-family: var(--lit-devtools-font-mono);
      }
      wa-input.filter {
        margin: var(--lit-devtools-space-4) 0 0;
        font-family: var(--lit-devtools-font-mono);
      }
      wa-input.filter wa-icon[slot='start'] {
        color: var(--lit-devtools-text-muted);
      }
      mark {
        background: var(--lit-devtools-warning-soft);
        color: inherit;
        border-radius: 2px;
      }
      .no-match {
        margin-top: var(--lit-devtools-space-5);
        color: var(--lit-devtools-text-muted);
      }
      .kv {
        display: grid;
        grid-template-columns: fit-content(45%) minmax(0, 1fr);
        column-gap: var(--lit-devtools-space-4);
        font-family: var(--lit-devtools-font-mono);
      }
      .entry {
        display: grid;
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        align-items: baseline;
        padding: 2px 0;
      }
      .entry > .name {
        color: var(--lit-devtools-text);
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .entry > .val {
        color: var(--lit-devtools-warning);
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .entry > .val.code {
        color: var(--lit-devtools-text);
        white-space: pre-wrap;
      }
      .t-key {
        color: var(--lit-devtools-code-property);
      }
      .t-string {
        color: var(--lit-devtools-code-string);
      }
      .t-number {
        color: var(--lit-devtools-code-number);
      }
      .t-keyword {
        color: var(--lit-devtools-code-keyword);
      }
      .t-type,
      .t-tag {
        color: var(--lit-devtools-code-tag);
      }
      .t-callee {
        color: var(--lit-devtools-code-callee);
      }
      .t-punct,
      .t-muted {
        color: var(--lit-devtools-text-muted);
      }
      /* A wide row is two full lines, so neither half sizes the name column. */
      .entry.wide > .name {
        grid-column: 1 / -1;
      }
      .entry.wide > .val {
        grid-column: 1 / -1;
        padding-left: var(--lit-devtools-space-5);
      }
      .type {
        margin-left: var(--lit-devtools-space-2);
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-text-muted);
      }
      .badge {
        margin-left: var(--lit-devtools-space-2);
        vertical-align: middle;
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
      .entry.region:hover {
        background: var(--lit-devtools-surface-hover);
      }
      .entry.orphan > * {
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
  /**
   * Narrows every details section to rows whose name or value contains it,
   * case-insensitively. Kept across selections, so comparing one row on
   * several elements needs no retyping.
   */
  @state() private _query = '';
  /** Details sections the user folded, by label. */
  @state() private _collapsed: ReadonlySet<string> = readCollapsed();
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

  /** Single out a slot or part in the page's anatomy overlay while hovered. */
  private _focusRegion(focus: AnatomyFocus | null): void {
    if (this._anatomy) sendToPage({type: 'anatomy-focus', focus});
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

  /**
   * One `name value` line; long values drop below the name. A `code` value
   * is a serialized JS preview and is coloured and re-flowed as one.
   */
  private _renderEntry(
    name: TemplateResult | string,
    value: string,
    trailing: unknown = nothing,
    code = false
  ): TemplateResult {
    return html`<div class="entry ${value.length > WIDE_VALUE ? 'wide' : ''}">
      <span class="name">${name}</span>
      <span class="val ${code ? 'code' : ''}"
        >${code ? renderCode(value) : value}${trailing}</span
      >
    </div>`;
  }

  private _renderPropTable(
    props: InspectorDetails['properties']
  ): TemplateResult {
    return html`
      <div class="kv">
        ${props.map((p) =>
          this._renderEntry(
            html`${this._mark(p.name)}${typeLabel(p.type, p.value)}`,
            p.value,
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
              : nothing,
            true
          )
        )}
      </div>
    `;
  }

  /**
   * Instance state. The kind follows the name like a type tag (a field shows
   * its type instead, since "field" says nothing), then a task's status as
   * a coloured dot.
   */
  private _renderExtraTable(extras: InspectorExtra[]): TemplateResult {
    return html`
      <div class="kv">
        ${extras.map((e) =>
          this._renderEntry(
            html`${this._mark(e.name)}${
              e.kind === 'field'
                ? typeLabel(e.type, e.value)
                : html`<span class="type kind" data-tip=${e.type}
                    >${e.kind}</span
                  >`
            }${
              e.status === undefined
                ? nothing
                : html`<span class="status task-${e.status}">${e.status}</span>`
            }`,
            e.value,
            nothing,
            true
          )
        )}
      </div>
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
    // Filtered rows render as `nothing` in place, so every row keeps the
    // index its colour and overlay region are keyed by.
    const m = anatomyMatches(a, (...t) => this._matches(...t));
    const slotsShown =
      m.slots.filter(Boolean).length +
      m.orphans.filter(Boolean).length +
      (m.orphanText ? 1 : 0);
    return html`
      ${this._renderSection(
        'Slots',
        slotsShown,
        a.slots.length + a.orphans.length + (a.orphanText > 0 ? 1 : 0),
        html`
          <div class="kv">
            ${a.slots.map((s, i) =>
              !m.slots[i]
                ? nothing
                : html`<div
                    class="entry region"
                    @mouseenter=${() => this._focusRegion({kind: 'slot', index: i})}
                    @mouseleave=${() => this._focusRegion(null)}
                  >
                    <span class="name">
                      <span class="swatch" style="background:${color(i)}"></span
                      >${
                        s.name === ''
                          ? html`<span class="slot-default"
                              >${this._mark('default')}</span
                            >`
                          : this._mark(s.name)
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
                    </span>
                    <span class="val">
                      ${s.elements.map((e) => this._renderElementRef(e))}${
                        s.moreElements > 0
                          ? html`<span class="muted">+${s.moreElements}</span>`
                          : nothing
                      }${
                        s.textNodes > 0
                          ? html`<span class="muted">${s.textNodes} text</span>`
                          : nothing
                      }
                    </span>
                  </div>`
            )}
            ${a.orphans.map((o, k) =>
              !m.orphans[k]
                ? nothing
                : html`<div
                    class="entry orphan"
                    data-tip="No slot takes this child, so it is not rendered"
                  >
                    <span class="name">
                      ${o.slot === '' ? 'no default slot' : `slot="${o.slot}"`}
                    </span>
                    <span class="val">
                      ${this._renderElementRef(o)}<span class="muted"
                        >not rendered</span
                      >
                    </span>
                  </div>`
            )}
            ${
              m.orphanText
                ? html`<div class="entry orphan">
                    <span class="name">no default slot</span>
                    <span class="val">${a.orphanText} text, not rendered</span>
                  </div>`
                : nothing
            }
          </div>
        `
      )}
      ${this._renderSection(
        'Parts',
        m.parts.filter(Boolean).length,
        a.parts.length,
        html`
          <div class="kv">
            ${a.parts.map((p, j) =>
              !m.parts[j]
                ? nothing
                : html`<div
                    class="entry region"
                    @mouseenter=${() => this._focusRegion({kind: 'part', index: j})}
                    @mouseleave=${() => this._focusRegion(null)}
                  >
                    <span class="name">
                      <span
                        class="swatch"
                        style="background:${color(a.slots.length + j)}"
                      ></span
                      >${this._mark(p.names.join(' '))}
                    </span>
                    <span class="val code"
                      ><span class="t-punct">&lt;</span
                      ><span class="t-tag">${p.tagName}</span
                      ><span class="t-punct">&gt;</span></span
                    >
                  </div>`
            )}
          </div>
        `
      )}
    `;
  }

  /**
   * A details section that folds on its heading, with its row count beside
   * the label. Which sections are folded is remembered across selections and
   * reloads, keyed by label. While a filter is set, the count reads
   * `shown/total`, a section with no match is left out, and the rest show
   * open without touching the remembered folds.
   */
  private _renderSection(
    label: string,
    shown: number,
    total: number,
    body: TemplateResult
  ): TemplateResult | typeof nothing {
    const filtering = this._filtering;
    if (total === 0 || (filtering && shown === 0)) return nothing;
    const open = filtering || !this._collapsed.has(label);
    return html`<details
      class="section"
      data-section=${label}
      ?open=${open}
      @toggle=${(e: Event) => {
        // Opening for a filter is not the user's fold.
        if (this._filtering) return;
        this._setCollapsed(label, !(e.target as HTMLDetailsElement).open);
      }}
    >
      <summary>
        <wa-icon name=${open ? 'caret-down' : 'caret-right'}></wa-icon>
        <span class="label">${label}</span>
        <span class="count">${filtering ? `${shown}/${total}` : total}</span>
      </summary>
      ${body}
    </details>`;
  }

  private get _filtering(): boolean {
    return this._query.trim() !== '';
  }

  /** Whether any of `texts` contains the filter; true with no filter. */
  private _matches(...texts: string[]): boolean {
    const q = this._query.trim().toLowerCase();
    return q === '' || texts.some((t) => t.toLowerCase().includes(q));
  }

  /** `text` with the first filter match wrapped in `<mark>`. */
  private _mark(text: string): TemplateResult | string {
    const q = this._query.trim().toLowerCase();
    const at = q === '' ? -1 : text.toLowerCase().indexOf(q);
    if (at < 0) return text;
    return html`${text.slice(0, at)}<mark>${text.slice(at, at + q.length)}</mark>${text.slice(at + q.length)}`;
  }

  private _onFilterInput(e: Event): void {
    this._query = (e.target as WaInput).value ?? '';
  }

  private _onFilterKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || this._query === '') return;
    e.stopPropagation();
    this._query = '';
  }

  private _setCollapsed(label: string, collapsed: boolean): void {
    if (this._collapsed.has(label) === collapsed) return;
    const next = new Set(this._collapsed);
    if (collapsed) next.add(label);
    else next.delete(label);
    this._collapsed = next;
    try {
      localStorage.setItem(COLLAPSED_LS_KEY, JSON.stringify([...next]));
    } catch {
      // Storage unavailable: the fold just won't be remembered.
    }
  }

  /** A `file:line` that opens in the editor, or plain text without one. */
  private _renderLocation(
    loc: {file: string; line: number},
    cls: string,
    tip: string,
    open: () => void
  ): TemplateResult {
    const text = `${loc.file}:${loc.line}`;
    return this._canOpen
      ? html`<button class="link ${cls}" data-tip=${tip} @click=${open}>
          ${text}<wa-icon name="arrow-square-out"></wa-icon>
        </button>`
      : html`<span class="${cls} src-text">${text}</span>`;
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
    const byRow = (name: string, value: string) => this._matches(name, value);
    const allProps = d.properties.filter((p) => !p.state);
    const allState = d.properties.filter((p) => p.state);
    const allExtras = d.extras ?? [];
    const props = allProps.filter((p) => byRow(p.name, p.value));
    const stateProps = allState.filter((p) => byRow(p.name, p.value));
    const attributes = d.attributes.filter((a) => byRow(a.name, a.value));
    const extras = allExtras.filter((e) => byRow(e.name, e.value));
    const anatomyHit =
      d.anatomy !== undefined &&
      Object.values(
        anatomyMatches(d.anatomy, (...t) => this._matches(...t))
      ).some((v) => (Array.isArray(v) ? v.includes(true) : v));
    const anyMatch =
      props.length + stateProps.length + attributes.length + extras.length >
        0 || anatomyHit;
    const rootLabel = describeRoot(d);
    return html`
      <div class="head">
        <h2>&lt;${d.tagName}&gt;</h2>
        ${
          d.flags.isUpdatePending
            ? html`<span
                class="status pending"
                data-tip="An update is queued and has not run yet"
                >pending</span
              >`
            : nothing
        }
        ${
          d.flags.hasUpdated
            ? nothing
            : html`<span
                class="status"
                data-tip="The element has not finished its first update"
                >not rendered</span
              >`
        }
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
      <dl class="meta">
        ${
          d.source === undefined
            ? nothing
            : html`<dt>defined</dt>
                <dd>
                  ${this._renderLocation(
                    d.source,
                    'src',
                    'Open the class definition in your editor',
                    this._openSource
                  )}
                </dd>`
        }
        ${
          d.callSite === undefined
            ? nothing
            : html`<dt>rendered</dt>
                <dd>
                  ${this._renderLocation(
                    d.callSite,
                    'src call-site',
                    'Open the template that renders this element',
                    this._openCallSite
                  )}
                </dd>`
        }
        ${
          rootLabel === undefined
            ? nothing
            : html`<dt>root</dt>
                <dd class="root">${rootLabel}</dd>`
        }
      </dl>
      <wa-input
        class="filter"
        size="small"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="Filter rows"
        aria-label="Filter rows by name or value"
        with-clear
        .value=${this._query}
        @input=${this._onFilterInput}
        @wa-clear=${() => (this._query = '')}
        @keydown=${this._onFilterKeydown}
      >
        <wa-icon slot="start" name="magnifying-glass"></wa-icon>
        <wa-icon slot="clear-icon" name="x"></wa-icon>
      </wa-input>
      ${d.anatomy === undefined ? nothing : this._renderAnatomy(d.anatomy)}
      ${this._renderSection(
        'Properties',
        props.length,
        allProps.length,
        this._renderPropTable(props)
      )}
      ${this._renderSection(
        'State',
        stateProps.length,
        allState.length,
        this._renderPropTable(stateProps)
      )}
      ${this._renderSection(
        'Attributes',
        attributes.length,
        d.attributes.length,
        html`
          <div class="kv">
            ${attributes.map((a) =>
              // Quoted, so it colours as the string it is.
              this._renderEntry(
                this._mark(a.name),
                JSON.stringify(a.value),
                nothing,
                true
              )
            )}
          </div>
        `
      )}
      ${this._renderSection(
        'Instance',
        extras.length,
        allExtras.length,
        this._renderExtraTable(extras)
      )}
      ${
        this._filtering && !anyMatch
          ? html`<div class="no-match">
              No rows match “${this._query.trim()}”.
            </div>`
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
