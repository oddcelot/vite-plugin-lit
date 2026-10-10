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
  type ElementSource,
  type InspectorAnatomy,
  type InspectorDetails,
  type InspectorProp,
  type InspectorPropOption,
  type InspectorContext,
  type InspectorExtra,
  type InspectorMessage,
  type InspectorTreeNode,
  type ValueChild,
  type ValuePath,
} from '../types/inspector.js';
import {
  describeHmrReason,
  type HmrIncompatibilityEvent,
} from '../types/hmr-incompatibility.js';
import type {HmrPatchEvent} from '../types/hmr-patch.js';
import type {
  ComponentDocs,
  DocEntry,
  DocsOrigin,
} from '../types/component-docs.js';
import {describeError, getMeta, litRpc} from './client.js';
import {ComponentsSession} from './components-session.js';
import {ComponentDocsSource} from './component-docs.js';
import {LocationController} from './location-controller.js';
import {PanelLocation} from './panel-location.js';
import {openInEditor} from './open-in-editor.js';
import {elementRevealer} from './element-revealer.js';
import {sourceOpenerFor} from './source-opener.js';
import {hostInfo, sendToPage, touchPageChannel} from './host.js';
import {overrides} from './settings-override.js';
import {formatLines, type ValueToken} from './value-format.js';
import {filterTree, type TreeFilterResult} from './tree-filter.js';
import {ValueExpansion} from './value-expansion.js';
import {copyText} from './copy-text.js';
import {attrKey, changedRows, extraKey, propKey} from './details-diff.js';

/**
 * localStorage key remembering a paused live tree. Live is the default, so
 * only an explicit `'false'` turns it off.
 */
/** localStorage key remembering the details pane's width in pixels. */
const DETAILS_WIDTH_LS_KEY = 'lit-devtools-components-details-width';
const DETAILS_WIDTH_DEFAULT = 340;
const DETAILS_WIDTH_MIN = 220;

/** localStorage key remembering that Anatomy was left on. */
const ANATOMY_LS_KEY = 'lit-devtools-components-anatomy';

const readAnatomy = (): boolean => {
  try {
    return localStorage.getItem(ANATOMY_LS_KEY) === 'true';
  } catch {
    return false;
  }
};

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
  parts: a.parts.map((p) =>
    matches(...p.names, p.tagName, ...(p.forwarded ? [p.forwarded.from] : []))
  ),
});

/** Distinct warned tags in the tree: Lit warns once per tag, not per instance. */
const warnedTagCount = (roots: readonly InspectorTreeNode[]): number => {
  const tags = new Set<string>();
  const walk = (nodes: readonly InspectorTreeNode[]): void => {
    for (const n of nodes) {
      if (n.warnings !== undefined && n.warnings > 0) tags.add(n.tagName);
      walk(n.children);
    }
  };
  walk(roots);
  return tags.size;
};

/** The row marker for a component Lit warned about; nothing when it hasn't. */
const warnedChip = (
  count: number | undefined
): TemplateResult | typeof nothing => {
  if (count === undefined || count === 0) return nothing;
  const noun = count === 1 ? 'warning' : 'warnings';
  const tip = `${count} Lit ${noun} \u2014 select to read ${count === 1 ? 'it' : 'them'}`;
  return html`<span class="status warned" data-tip=${tip}
    >${`${count} ${noun}`}</span
  >`;
};

/** Marks a custom element another library defined, in the tree and the pane. */
const notLitChip = html`<span
  class="status not-lit"
  data-tip="A custom element, but not a Lit component"
  >not Lit</span
>`;

/** Ids of every node in the tree with this tag, in tree order. */
const idsWithTag = (
  roots: readonly InspectorTreeNode[],
  tagName: string
): number[] => {
  const ids: number[] = [];
  const visit = (n: InspectorTreeNode): void => {
    if (n.tagName === tagName) ids.push(n.id);
    n.children.forEach(visit);
  };
  roots.forEach(visit);
  return ids;
};

/** `text` with the first match of `query` wrapped in `<mark>`. */
const markMatch = (text: string, query: string): TemplateResult | string => {
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : text.toLowerCase().indexOf(q);
  if (at < 0) return text;
  return html`${text.slice(0, at)}<mark>${text.slice(at, at + q.length)}</mark>${text.slice(at + q.length)}`;
};

const renderTokens = (tokens: ValueToken[]): TemplateResult[] =>
  tokens.map((t) =>
    t.kind === 'text'
      ? html`${t.text}`
      : html`<span class="t-${t.kind}">${t.text}</span>`
  );

/**
 * A serialized preview as coloured spans. A re-flowed preview renders one
 * block per line, indented by its depth with a hanging indent, so a long
 * string that wraps continues under its own text instead of at the margin.
 */
const renderCode = (
  value: string,
  /** Leads the first line, so a caret sits beside the value's opening. */
  lead: unknown = nothing
): TemplateResult | TemplateResult[] => {
  const lines = formatLines(value);
  if (lines.length === 1) return html`${lead}${renderTokens(lines[0]!.tokens)}`;
  return lines.map(
    (l, i) =>
      html`<span class="line" style="--indent:${l.indent}"
        >${i === 0 ? lead : nothing}${renderTokens(l.tokens)}</span
      >`
  );
};

/**
 * What an open value shows in place of its preview, since its children now
 * say the rest: `Array(3)`, `Map(2)`, a class name, or `Object`.
 */
const summarize = (type: string): TemplateResult =>
  html`<span class="t-type">${type === 'object' ? 'Object' : type}</span>`;

/**
 * A type name read off a preview, for a value whose type tag is not to hand:
 * `Map(2)` or `MyClass` from their prefix, else `Array` or `object`.
 */
const typeOfPreview = (value: string): string =>
  /^[A-Za-z_$][\w$.]*(?:\(\d+\))?/.exec(value)?.[0] ??
  (value.startsWith('[') ? 'Array' : 'object');

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
const PROP_OPTION_TIPS: Record<InspectorPropOption, string> = {
  hasChanged: 'A custom hasChanged decides whether a set triggers an update',
  converter: 'A custom converter maps between the attribute and the property',
  noAccessor: 'noAccessor: Lit generates no accessor for this property',
  useDefault: 'useDefault: the initial value is not reflected to the attribute',
};

/** Badges for the options a property sets beyond Lit's defaults. */
const propOptionBadges = (p: InspectorProp): TemplateResult[] => {
  const badge = (label: string, tip: string) =>
    html`<wa-badge
      class="badge"
      variant="neutral"
      appearance="outlined"
      data-tip=${tip}
      >${label}</wa-badge
    >`;
  return [
    ...(p.attribute === false && !p.state
      ? [badge('no attr', 'attribute: false, so no attribute is observed')]
      : []),
    ...(p.options ?? []).map((o) => badge(o, PROP_OPTION_TIPS[o])),
  ];
};

/** The manifest's summary and description as one block, if it has either. */
const aboutText = (docs: ComponentDocs): string | undefined => {
  const text = [docs.summary, docs.description]
    .filter((t) => t !== undefined && t !== '')
    .join('\n\n');
  return text === '' ? undefined : text;
};

/** The selected element's manifest docs, as the details pane shows them. */
interface DocsView {
  docs: ComponentDocs | null;
  about?: string;
  /** The about text matches the row filter (or there is none). */
  aboutShown: boolean;
  /** Filtered by the row filter. */
  events: DocEntry[];
  cssProperties: DocEntry[];
  /** Unfiltered: these only lend descriptions to the live rows. */
  properties: readonly DocEntry[];
  attributes: readonly DocEntry[];
  slots: readonly DocEntry[];
  cssParts: readonly DocEntry[];
  anyMatch: boolean;
}

const NO_DOCS: DocsView = {
  docs: null,
  aboutShown: false,
  events: [],
  cssProperties: [],
  properties: [],
  attributes: [],
  slots: [],
  cssParts: [],
  anyMatch: false,
};

/** The manifest marks the component deprecated, with its reason if given. */
const deprecatedChip = (
  docs: ComponentDocs | null
): TemplateResult | typeof nothing => {
  const deprecated = docs?.deprecated;
  if (deprecated === undefined || deprecated === false) return nothing;
  return html`<span
    class="status warned"
    data-tip=${typeof deprecated === 'string' ? deprecated : 'Marked deprecated in its manifest'}
    >deprecated</span
  >`;
};

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
      /* The inputs carry a \`label\` for their accessible name; WA renders it
         visibly, and the placeholder or the text beside them already says it. */
      wa-input[label]::part(form-control-label),
      wa-select[label]::part(form-control-label) {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .toolbar wa-button,
      .toolbar wa-input {
        --wa-form-control-height: var(--lit-devtools-control-height);
      }
      .toolbar wa-button::part(base) {
        min-height: var(--lit-devtools-control-height);
      }
      wa-input.tree-filter {
        width: 200px;
        min-width: 120px;
        flex-shrink: 1;
        font-family: var(--lit-devtools-font-mono);
      }
      wa-input.tree-filter wa-icon[slot='start'],
      .match-count {
        color: var(--lit-devtools-text-muted);
      }
      .match-count {
        font-size: var(--lit-devtools-text-2xs);
      }
      .row.same-tag {
        background: var(--lit-devtools-accent-soft);
      }
      .row.context .tag {
        opacity: 0.55;
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
        box-sizing: border-box;
        min-height: var(--lit-devtools-row-height);
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
      /* A brand tint plus a 2px bar, so the selection survives low contrast. */
      .row.selected {
        background: color-mix(
          in srgb,
          var(--lit-devtools-lit-blue) 18%,
          var(--lit-devtools-surface)
        );
        box-shadow: inset 2px 0 0 var(--lit-devtools-lit-blue);
      }
      .row.selected .tag {
        color: var(--lit-devtools-text-strong);
      }
      .row:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
        outline-offset: -2px;
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
        color: var(--lit-devtools-text);
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
        /* One key column for the whole pane: the meta list and every section's
           rows are subgrids of it, so all values start at the same x. */
        display: grid;
        grid-template-columns: fit-content(45%) minmax(0, 1fr);
        column-gap: var(--lit-devtools-space-4);
        align-content: start;
      }
      .details > * {
        grid-column: 1 / -1;
      }
      .details .head {
        display: flex;
        align-items: center;
        gap: var(--lit-devtools-space-3);
        margin: 0 0 var(--lit-devtools-space-3);
      }
      .details h2 {
        font-size: 15px;
        font-weight: var(--lit-devtools-weight-semibold);
        font-family: var(--lit-devtools-font-mono);
        color: var(--lit-devtools-text-strong);
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .details h2 .punct {
        color: var(--lit-devtools-text-muted);
      }
      .details .head .reveal {
        margin-left: auto;
      }
      /* Icon-only buttons keep a 24px hit area whatever the button size. */
      .details .head .reveal::part(base) {
        min-width: 24px;
        min-height: 24px;
      }
      .details .head .reveal + .reveal {
        margin-left: 0;
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
      .status.pending,
      .status.warned,
      .status.undefined {
        color: var(--lit-devtools-warning);
      }
      .status.not-lit {
        color: var(--lit-devtools-text-muted);
      }
      .row .status.undefined,
      .row .status.not-lit,
      .row .status.warned {
        margin-left: var(--lit-devtools-space-3);
      }
      .not-defined-note {
        margin: var(--lit-devtools-space-3) 0;
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-xs);
      }
      .about {
        margin: var(--lit-devtools-space-2) 0;
        white-space: pre-line;
      }
      .about-origin {
        margin: 0 0 var(--lit-devtools-space-2);
        color: var(--lit-devtools-text-muted);
        font-size: var(--lit-devtools-text-xs);
      }
      .described {
        text-decoration: underline dotted;
        text-underline-offset: 2px;
      }
      .val.doc {
        color: var(--lit-devtools-text-muted);
        white-space: pre-line;
      }
      .warning {
        grid-column: 1 / -1;
        display: grid;
        gap: var(--lit-devtools-space-1);
        padding: var(--lit-devtools-space-2) 0;
      }
      .warning .code {
        font-family: var(--lit-devtools-font-mono);
        font-size: var(--lit-devtools-text-2xs);
        color: var(--lit-devtools-warning);
      }
      .warning .text {
        overflow-wrap: anywhere;
      }
      .meta {
        display: grid;
        grid-template-columns: subgrid;
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
        display: grid;
        grid-template-columns: subgrid;
        margin-top: var(--lit-devtools-space-5);
        padding-top: var(--lit-devtools-space-4);
        border-top: 1px solid var(--lit-devtools-border);
      }
      /* The section's rows are its grid items; the fold's content box is not. */
      .section::details-content {
        display: contents;
      }
      .section > summary {
        grid-column: 1 / -1;
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
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        font-family: var(--lit-devtools-font-mono);
      }
      .entry {
        display: grid;
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        align-items: baseline;
        padding: 2px 0;
      }
      .entry {
        position: relative;
      }
      .copy {
        position: absolute;
        top: 0;
        right: 0;
        display: inline-flex;
        padding: 2px var(--lit-devtools-space-2);
        border: 0;
        border-radius: 2px;
        background: var(--lit-devtools-bg);
        color: var(--lit-devtools-text-muted);
        cursor: pointer;
        opacity: 0;
      }
      .entry:hover > .copy,
      .copy:focus-visible,
      .copy.copied {
        opacity: 1;
      }
      .copy:hover {
        color: var(--lit-devtools-text);
      }
      .copy.copied {
        color: var(--lit-devtools-success);
      }
      .copy:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
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
      /* A caret leads the first line, so the rest move over to match. */
      .val.has-caret .line:not(:first-child) {
        padding-left: calc((var(--indent) + 4) * 1ch);
      }
      /* Indent by depth; wrapped rows hang two columns further in. */
      .val .line {
        display: block;
        padding-left: calc((var(--indent) + 2) * 1ch);
        text-indent: -2ch;
      }
      .expander,
      .expander-space {
        display: inline-flex;
        width: 1.5ch;
        margin-right: 0.5ch;
        vertical-align: -0.1em;
      }
      .expander {
        padding: 0;
        border: 0;
        background: none;
        color: var(--lit-devtools-text-muted);
        cursor: pointer;
        font: inherit;
      }
      .expander:hover {
        color: var(--lit-devtools-text);
      }
      .expander:focus-visible {
        outline: 2px solid var(--lit-devtools-accent-ring);
        border-radius: 2px;
      }
      .children {
        display: block;
        margin: 2px 0 2px 0.75ch;
        padding-left: 1.25ch;
        border-left: 1px solid var(--lit-devtools-border-subtle);
        white-space: normal;
        text-indent: 0;
      }
      /* Wrapped rows hang under the key, past the caret column. */
      .child {
        padding: 1px 0 1px 2ch;
        text-indent: -2ch;
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
      /* Small tags beside a value: quiet text on a faint fill, no border. */
      .type {
        margin-left: var(--lit-devtools-space-2);
        padding: 0 var(--lit-devtools-space-2);
        font-size: 11px;
        color: var(--lit-devtools-text-muted);
        background: var(--lit-devtools-surface-container);
      }
      .badge {
        margin-left: var(--lit-devtools-space-2);
        vertical-align: middle;
        font-size: 11px;
        border: 0;
        padding: 0 var(--lit-devtools-space-2);
        background: var(--lit-devtools-surface-container);
        color: var(--lit-devtools-text-muted);
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
      .ctx-links {
        margin-top: var(--lit-devtools-space-1);
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
  /** The host reads Custom Elements Manifests (`component-docs`). */
  @state() private _canReadDocs = false;
  private readonly _docs = new ComponentDocsSource(() => this.requestUpdate());
  /** A frozen snapshot: no page to reveal elements in or explain. */
  @state() private _snapshot = false;
  /** Mirror of the `flashUpdates` override; the Settings tab shows it too. */
  @state() private _flash = false;
  /** Draw the selected element's slots and parts on the page; remembered. */
  @state() private _anatomy = readAnatomy();
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
  /**
   * Narrows the tree to elements whose tag or class name contains it, with
   * their ancestors for context. Never touches the remembered expansion.
   */
  @state() private _treeQuery = '';
  /** Details sections the user folded, by label. */
  @state() private _collapsed: ReadonlySet<string> = readCollapsed();
  /** Collapse state of the banner; the events themselves are never cleared. */
  @state() private _hmrExpanded = true;
  /** Details pane width in pixels, restored once; the split panel owns it
   *  after that and `_saveDetailsWidth` persists each drag. */
  private readonly _detailsWidth = readDetailsWidth();
  private _unsubscribeOverride: (() => void) | null = null;
  private _unsubscribeSession: (() => void) | null = null;
  /** The tree row under the pointer, so Shift can act on it. */
  private _hovered: InspectorTreeNode | null = null;
  /** The tag whose rows are marked while Shift-hovering, or null. */
  @state() private _tagHover: string | null = null;
  /** The row whose value was just copied, for a moment of feedback. */
  @state() private _copied: string | null = null;
  private _copiedTimer: ReturnType<typeof setTimeout> | undefined;
  /** Values opened in the details pane, and their children. */
  private readonly _expansion = new ValueExpansion(sendToPage, () =>
    this.requestUpdate()
  );
  /** The details last rendered, to tell which rows a refresh changed. */
  private _shownDetails: InspectorDetails | null = null;
  /** Rows to highlight once the render that changed them lands. */
  private _pendingFlash = new Set<string>();
  private _reportedIncompatibilities: unknown = null;
  private _reportedWarningRoots: unknown = null;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onShift);
    window.addEventListener('keyup', this._onShift);
    this._unsubscribeSession = this._session.subscribe(() => {
      this.requestUpdate();
      this._reportIncompatibilities();
      this._reportWarnings();
    });
    this._flash = overrides.get().flashUpdates ?? false;
    this._unsubscribeOverride = overrides.subscribe((o) => {
      this._flash = o.flashUpdates ?? false;
    });
    void this._connect();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onShift);
    window.removeEventListener('keyup', this._onShift);
    this._unsubscribeOverride?.();
    this._unsubscribeOverride = null;
    this._unsubscribeSession?.();
    this._unsubscribeSession = null;
    this._session.dispose();
    this._syncAnatomy(null);
  }

  protected override willUpdate(): void {
    const d = this._session.details;
    if (d === this._shownDetails) return;
    this._expansion.follow(d?.id ?? null);
    // Only a refresh of the same element can change a row; a new selection
    // or the first snapshot flashes nothing. A changed row also re-asks for
    // whatever is open under it.
    for (const key of changedRows(this._shownDetails, d)) {
      this._pendingFlash.add(key);
      const name = key.slice(2);
      if (key === propKey(name)) this._expansion.refresh('prop', name);
      else if (key === extraKey(name)) this._expansion.refresh('extra', name);
    }
    this._shownDetails = d;
  }

  protected override updated(): void {
    this._flashChangedRows();
    this._syncAnatomy(
      this._anatomy && !this._snapshot ? this._session.selectedId : null
    );
  }

  /**
   * Fade a highlight out of each row whose value just changed. The Web
   * Animations API restarts cleanly when a value changes again mid-fade,
   * which a CSS class would not. A colour fade without motion, so it runs
   * under reduced motion too.
   */
  private _flashChangedRows(): void {
    if (this._pendingFlash.size === 0) return;
    const keys = this._pendingFlash;
    this._pendingFlash = new Set();
    for (const row of this.renderRoot.querySelectorAll<HTMLElement>(
      '.details .entry[data-key]'
    )) {
      if (!keys.has(row.dataset['key']!) || typeof row.animate !== 'function') {
        continue;
      }
      // Keyframes take resolved colours, not var() references.
      const from = getComputedStyle(row)
        .getPropertyValue('--lit-devtools-warning-soft')
        .trim();
      row.animate(
        [
          {backgroundColor: from || 'transparent'},
          {backgroundColor: 'transparent'},
        ],
        {duration: 1200, easing: 'ease-out'}
      );
    }
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

  /** Tell the panel shell how many distinct components Lit warned about. */
  private _reportWarnings(): void {
    const roots = this._session.roots;
    if (roots === this._reportedWarningRoots) return;
    this._reportedWarningRoots = roots;
    this.dispatchEvent(
      new CustomEvent('warning-count-change', {
        detail: {count: warnedTagCount(roots)},
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
        handler: (message: InspectorMessage) => {
          if (message.type === 'expanded') this._expansion.receive(message);
          else this._session.receive(message);
        },
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
        this._canReadDocs = host.componentDocs;
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
    try {
      localStorage.setItem(ANATOMY_LS_KEY, String(this._anatomy));
    } catch {
      // Storage unavailable: the toggle just won't be remembered.
    }
  }

  /** Outline an element in the page; fires on every `mouseenter` in the tree. */
  private _highlight(id: number | null): void {
    sendToPage({type: 'highlight', id});
  }

  /**
   * Outline a hovered tree row's element on the page, or with Shift held,
   * every element with the same tag, and mark their rows here.
   */
  private _hoverRow(node: InspectorTreeNode, all: boolean): void {
    this._hovered = node;
    if (!all) {
      this._tagHover = null;
      this._highlight(node.id);
      return;
    }
    this._tagHover = node.tagName;
    sendToPage({
      type: 'highlight-all',
      ids: idsWithTag(this._session.roots, node.tagName),
    });
  }

  private readonly _leaveTree = (): void => {
    this._hovered = null;
    this._tagHover = null;
    this._highlight(null);
  };

  /** Shift pressed or released over a row switches between one and all. */
  private readonly _onShift = (e: KeyboardEvent): void => {
    if (e.key !== 'Shift' || e.repeat || this._hovered === null) return;
    this._hoverRow(this._hovered, e.type === 'keydown');
  };

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
    // Resolved through the page's sourcemaps: DevTools has it, no editor does.
    const opener = sourceOpenerFor(src, this._canOpen);
    if (opener !== undefined) void opener(src);
    else void openInEditor(src.file, src.line);
  }

  private _openCallSite(): void {
    const site = this._session.details?.callSite;
    if (site === undefined) return;
    const opener = sourceOpenerFor(site, this._canOpen);
    if (opener !== undefined) void opener(site);
    else void openInEditor(site.file, site.line, site.column);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * One tree row and, when expanded, its children. With a filter, only kept
   * nodes render, every kept node shows open, and the twisty does nothing,
   * so the user's own expansion is back as it was once the filter clears.
   */
  private _renderNode(
    node: InspectorTreeNode,
    depth: number,
    filter?: TreeFilterResult
  ): TemplateResult | typeof nothing {
    if (filter !== undefined && !filter.keep.has(node.id)) return nothing;
    const children =
      filter === undefined
        ? node.children
        : node.children.filter((c) => filter.keep.has(c.id));
    const hasChildren = children.length > 0;
    const expanded =
      filter !== undefined || this._session.expanded.has(node.id);
    const dimmed = filter !== undefined && !filter.matched.has(node.id);
    const selected = node.id === this._session.selectedId;
    return html`
      <div
        class="row ${selected ? 'selected' : ''} ${
          dimmed ? 'context' : ''
        } ${this._tagHover === node.tagName ? 'same-tag' : ''}"
        role="treeitem"
        aria-level=${depth + 1}
        aria-selected=${selected ? 'true' : 'false'}
        aria-expanded=${hasChildren ? (expanded ? 'true' : 'false') : nothing}
        tabindex=${node.id === (this._session.selectedId ?? this._session.roots[0]?.id) ? 0 : -1}
        style="padding-left:${8 + depth * 14}px"
        @click=${() => this._session.select(node.id)}
        data-id=${node.id}
        @keydown=${(e: KeyboardEvent) =>
          this._onRowKeydown(
            e,
            node.id,
            hasChildren && filter === undefined ? expanded : undefined
          )}
        @mouseenter=${(e: MouseEvent) => this._hoverRow(node, e.shiftKey)}
      >
        <span
          class="twisty"
          @click=${(e: Event) => {
            e.stopPropagation();
            if (filter === undefined) this._session.toggleExpand(node.id);
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
          ><span class="punct">&lt;</span>${
            filter === undefined
              ? node.tagName
              : markMatch(node.tagName, this._treeQuery)
          }<span class="punct">&gt;</span></span
        >
        ${
          node.notDefined === true
            ? html`<span
                class="status undefined"
                data-tip="No custom element is defined for this tag"
                >not defined</span
              >`
            : nothing
        }
        ${node.notLit === true ? notLitChip : nothing}
        ${warnedChip(node.warnings)}
      </div>
      ${
        hasChildren && expanded
          ? children.map((c) => this._renderNode(c, depth + 1, filter))
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
    opts: {
      trailing?: unknown;
      code?: boolean;
      key?: string;
      /** Where to expand the value from, when it has children to list. */
      expand?: {path: ValuePath; type: string};
      /** What the copy button puts on the clipboard; no button without it. */
      copy?: string;
    } = {}
  ): TemplateResult {
    const {trailing = nothing, code = false, key, expand, copy} = opts;
    const expandable = expand !== undefined && !this._snapshot;
    const open = expandable && this._expansion.isOpen(expand.path);
    return html`<div
      class="entry ${open || value.length > WIDE_VALUE ? 'wide' : ''}"
      data-key=${key ?? nothing}
    >
      <span class="name">${name}</span>
      <span class="val ${code ? 'code' : ''} ${expandable ? 'has-caret' : ''}"
        >${(() => {
          const caret = expandable
            ? this._renderExpander(expand.path, name)
            : nothing;
          if (open) return html`${caret}${summarize(expand.type)}`;
          return code ? renderCode(value, caret) : html`${caret}${value}`;
        })()}${trailing}${open ? this._renderLevel(expand.path) : nothing}</span
      >${
        copy === undefined || key === undefined
          ? nothing
          : this._renderCopy(key, copy)
      }
    </div>`;
  }

  /**
   * A button that copies a row's value as the pane shows it: the preview
   * string, not the live object, so a truncated value copies truncated.
   */
  private _renderCopy(key: string, text: string): TemplateResult {
    const copied = this._copied === key;
    return html`<button
      class="copy ${copied ? 'copied' : ''}"
      data-tip=${copied ? 'Copied' : 'Copy the value as shown'}
      aria-label=${copied ? 'Copied' : 'Copy value'}
      @click=${(e: Event) =>
        void this._copy(key, text, e.currentTarget as HTMLElement)}
    >
      <wa-icon name=${copied ? 'check' : 'copy'}></wa-icon>
    </button>`;
  }

  private async _copy(
    key: string,
    text: string,
    button: HTMLElement
  ): Promise<void> {
    const ok = await copyText(text);
    // The fallback path selects a textarea outside this shadow root.
    button.focus();
    if (!ok) return;
    this._copied = key;
    clearTimeout(this._copiedTimer);
    this._copiedTimer = setTimeout(() => (this._copied = null), 1500);
  }

  private _renderExpander(
    path: ValuePath,
    label: TemplateResult | string
  ): TemplateResult {
    const open = this._expansion.isOpen(path);
    return html`<button
      class="expander"
      aria-expanded=${open ? 'true' : 'false'}
      aria-label=${`${open ? 'Collapse' : 'Expand'} ${
        typeof label === 'string' ? label : (path.keys.at(-1) ?? path.name)
      }`}
      @click=${() => this._expansion.toggle(path)}
    >
      <wa-icon name=${open ? 'caret-down' : 'caret-right'}></wa-icon>
    </button>`;
  }

  /** The children of an open value, each expandable in turn. */
  private _renderLevel(path: ValuePath): TemplateResult {
    const level = this._expansion.level(path);
    if (level === undefined || level.status === 'gone') {
      return html`<div class="children">
        <span class="muted"
          >${level === undefined ? '…' : 'no longer there'}</span
        >
      </div>`;
    }
    if (level.children === undefined) {
      return html`<div class="children"><span class="muted">…</span></div>`;
    }
    return html`<div class="children">
      ${level.children.map((c) => this._renderChild(path, c))}
      ${
        (level.more ?? 0) > 0
          ? html`<div class="child muted">+${level.more} more</div>`
          : nothing
      }
    </div>`;
  }

  private _renderChild(parent: ValuePath, c: ValueChild): TemplateResult {
    const path = {...parent, keys: [...parent.keys, c.key]};
    const open = c.expandable && this._expansion.isOpen(path);
    return html`<div class="child">
      ${
        c.expandable
          ? this._renderExpander(path, c.label)
          : html`<span class="expander-space"></span>`
      }<span class="t-key">${c.entry ? renderCode(c.label) : c.label}</span
      ><span class="t-punct">${c.entry ? ' => ' : ': '}</span
      >${open ? summarize(c.type) : renderCode(c.value)}${
        open ? this._renderLevel(path) : nothing
      }
    </div>`;
  }

  /**
   * A row name, with its manifest description as the tooltip when the
   * manifest documents a member of that name.
   */
  private _describedName(
    name: string,
    documented: readonly DocEntry[],
    shown: TemplateResult | string = this._mark(name)
  ): TemplateResult {
    const tip = documented.find((e) => e.name === name)?.description;
    return html`<span
      class=${tip === undefined ? '' : 'described'}
      data-tip=${tip ?? nothing}
      >${shown}</span
    >`;
  }

  /**
   * The manifest's docs for the selected element, narrowed by the row
   * filter. Empty when the host can't read manifests or none describes it.
   */
  private _docsView(d: InspectorDetails): DocsView {
    const docs =
      this._canReadDocs && d.notDefined !== true
        ? this._docs.for(d.tagName)
        : null;
    if (docs === null) return NO_DOCS;
    const byDoc = (e: DocEntry) =>
      this._matches(e.name, e.description ?? '', e.type ?? '');
    const events = docs.events.filter(byDoc);
    const cssProperties = docs.cssProperties.filter(byDoc);
    const about = aboutText(docs);
    const aboutShown = about !== undefined && this._matches(about);
    return {
      docs,
      about,
      aboutShown,
      events,
      cssProperties,
      properties: docs.properties,
      attributes: docs.attributes,
      slots: docs.slots,
      cssParts: docs.cssParts,
      anyMatch: aboutShown || events.length + cssProperties.length > 0,
    };
  }

  /** Events and CSS properties: members only the manifest knows about. */
  private _renderDocSections(view: DocsView): TemplateResult {
    return html`${this._renderSection(
      'Events',
      view.events.length,
      view.docs?.events.length ?? 0,
      this._renderDocTable(view.events, 'event')
    )}${this._renderSection(
      'CSS properties',
      view.cssProperties.length,
      view.docs?.cssProperties.length ?? 0,
      this._renderDocTable(view.cssProperties, 'cssprop')
    )}`;
  }

  /** The source module the dev server read, or the manifest and its package. */
  private _renderOrigin(origin: DocsOrigin): TemplateResult {
    if (origin.source === true) return html`<code>${origin.module}</code>`;
    return html`${
        origin.package === undefined
          ? "the project's"
          : html`<code>${origin.package}</code>`
      } <code>${origin.manifest}</code>`;
  }

  /** The manifest's summary and description, and where they came from. */
  private _renderAbout(view: DocsView): TemplateResult | typeof nothing {
    const {docs, about} = view;
    if (docs === null || about === undefined) return nothing;
    const {origin} = docs;
    return this._renderSection(
      'About',
      view.aboutShown ? 1 : 0,
      1,
      html`<p class="about">${this._mark(about)}</p>
        <p class="about-origin">From ${this._renderOrigin(origin)}</p>`
    );
  }

  /**
   * Members only the manifest knows about: events the class fires, CSS
   * custom properties it reads. The name carries the declared type; the
   * value column holds the description and any default.
   */
  private _renderDocTable(entries: DocEntry[], kind: string): TemplateResult {
    return html`<div class="kv">
      ${entries.map(
        (e) =>
          html`<div class="entry wide" data-key=${`${kind}:${e.name}`}>
            <span class="name"
              >${this._mark(e.name)}${
                e.type === undefined
                  ? nothing
                  : html`<span class="type">${e.type}</span>`
              }${
                e.inheritedFrom === undefined
                  ? nothing
                  : html`<span class="type" data-tip="Inherited"
                      >${e.inheritedFrom}</span
                    >`
              }</span
            >
            <span class="val doc"
              >${e.description === undefined ? nothing : this._mark(e.description)}${
                e.default === undefined
                  ? nothing
                  : html` <code class="default">${e.default}</code>`
              }</span
            >
          </div>`
      )}
    </div>`;
  }

  private _renderPropTable(
    props: InspectorDetails['properties'],
    documented: readonly DocEntry[]
  ): TemplateResult {
    return html`
      <div class="kv">
        ${props.map((p) =>
          this._renderEntry(
            html`${this._describedName(p.name, documented)}${typeLabel(
              p.type,
              p.value
            )}`,
            p.value,
            {
              trailing: html`${
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
              }${propOptionBadges(p)}`,
              code: true,
              key: propKey(p.name),
              copy: p.value,
              ...(p.expandable === true
                ? {
                    expand: {
                      path: {section: 'prop', name: p.name, keys: []},
                      type: p.type,
                    },
                  }
                : {}),
            }
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
              e.context === undefined
                ? nothing
                : html`<span class="type kind" data-tip=${e.context.role}
                    >${e.context.key}</span
                  >`
            }${
              e.status === undefined
                ? nothing
                : html`<span class="status task-${e.status}">${e.status}</span>`
            }`,
            e.value,
            {
              code: true,
              trailing:
                e.context === undefined
                  ? nothing
                  : this._renderContextLinks(e.context),
              key: extraKey(e.name),
              copy: e.value,
              ...(e.expandable === true
                ? {
                    expand: {
                      path: {section: 'extra', name: e.name, keys: []},
                      // A task's or signal's type is the wrapper's; the
                      // children are its value's.
                      type:
                        e.kind === 'field' ? e.type : typeOfPreview(e.value),
                    },
                  }
                : {}),
            }
          )
        )}
      </div>
    `;
  }

  /**
   * Who is on the other side of a context: the provider a consumer reads
   * from, or the consumers subscribed to a provider.
   */
  private _renderContextLinks(c: InspectorContext): TemplateResult {
    const refs =
      c.role === 'consumer'
        ? c.provider === undefined
          ? []
          : [c.provider]
        : (c.consumers ?? []);
    const label = c.role === 'consumer' ? 'from' : 'to';
    if (refs.length === 0) {
      return html`<div class="ctx-links">
        <span class="muted"
          >${c.role === 'consumer' ? 'no provider found' : 'no subscribers'}</span
        >
      </div>`;
    }
    return html`<div class="ctx-links">
      <span class="muted">${label}</span>
      ${refs.map((r) => this._renderElementRef(r))}
      ${
        c.moreConsumers === undefined
          ? nothing
          : html`<span class="muted">+${c.moreConsumers} more</span>`
      }
    </div>`;
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

  /** The name cell of a slot row: its default/named label and its status badges. */
  private _renderSlotName(
    s: InspectorAnatomy['slots'][number],
    color: string,
    documented: readonly DocEntry[]
  ): TemplateResult {
    return html`<span class="name">
      <span class="swatch" style="background:${color}"></span
      >${this._describedName(
        s.name,
        documented,
        s.name === ''
          ? html`<span class="slot-default">${this._mark('default')}</span>`
          : this._mark(s.name)
      )}${
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
    </span>`;
  }

  /** One slot row of the anatomy; hovering it focuses its region in the page. */
  private _renderSlotEntry(
    s: InspectorAnatomy['slots'][number],
    index: number,
    color: string,
    documented: readonly DocEntry[]
  ): TemplateResult {
    return html`<div
      class="entry region"
      @mouseenter=${() => this._focusRegion({kind: 'slot', index})}
      @mouseleave=${() => this._focusRegion(null)}
    >
      ${this._renderSlotName(s, color, documented)}
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
    </div>`;
  }

  /**
   * Slots and parts, coloured like their regions in the page's anatomy
   * overlay: slot `i` takes colour `i`, and parts continue after the slots.
   */
  private _renderAnatomy(a: InspectorAnatomy, docs: DocsView): TemplateResult {
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
              m.slots[i]
                ? this._renderSlotEntry(s, i, color(i), docs.slots)
                : nothing
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
                      >${this._describedName(
                        p.names.find((n) =>
                          docs.cssParts.some((e) => e.name === n)
                        ) ?? '',
                        docs.cssParts,
                        this._mark(p.names.join(' '))
                      )}${
                        p.forwarded
                          ? this._renderSlotBadge(
                              'forwarded',
                              p.forwarded.inner
                                ? `Forwarded by <${p.forwarded.from}> with exportparts, which renames "${p.forwarded.inner}"`
                                : `Forwarded by <${p.forwarded.from}> with exportparts`
                            )
                          : nothing
                      }
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

  /** `text` with the first details filter match wrapped in `<mark>`. */
  private _mark(text: string): TemplateResult | string {
    return markMatch(text, this._query);
  }

  /**
   * Tree keyboard, as in the browser's Elements panel: Up/Down select the
   * neighbouring row, Right opens a closed node, Left closes an open one or
   * moves to its parent. Rows render as flat siblings, so neighbours and
   * parents are found by walking them. `expanded` is undefined for leaves and
   * while a filter holds every node open.
   */
  private _onRowKeydown(
    e: KeyboardEvent,
    id: number,
    expanded: boolean | undefined
  ): void {
    if (e.target !== e.currentTarget) return;
    const row = e.currentTarget as HTMLElement;
    const rows = [
      ...row.parentElement!.querySelectorAll<HTMLElement>(
        ':scope > [role="treeitem"]'
      ),
    ];
    const at = rows.indexOf(row);
    let target: HTMLElement | undefined;
    switch (e.key) {
      case 'Enter':
      case ' ':
        this._session.select(id);
        break;
      case 'ArrowDown':
        target = rows[at + 1];
        break;
      case 'ArrowUp':
        target = rows[at - 1];
        break;
      case 'ArrowRight':
        if (expanded === false) this._session.toggleExpand(id);
        else target = rows[at + 1];
        break;
      case 'ArrowLeft': {
        if (expanded === true) {
          this._session.toggleExpand(id);
          break;
        }
        const level = Number(row.getAttribute('aria-level'));
        target = rows
          .slice(0, at)
          .reverse()
          .find((r) => Number(r.getAttribute('aria-level')) < level);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    if (target === undefined) return;
    this._session.select(Number(target.dataset['id']));
    target.focus();
  }

  private _onTreeFilterInput(e: Event): void {
    this._treeQuery = (e.target as WaInput).value ?? '';
  }

  private _onTreeFilterKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || this._treeQuery === '') return;
    e.stopPropagation();
    this._treeQuery = '';
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

  /**
   * A `file:line` that opens in the editor, or in the host's own viewer when
   * it has one for the location (`source-opener.ts`); plain text where
   * neither can open it.
   */
  private _renderLocation(
    loc: ElementSource,
    cls: string,
    tip: string,
    open: () => void
  ): TemplateResult {
    const text = `${loc.file}:${loc.line}`;
    const inHost = sourceOpenerFor(loc, this._canOpen) !== undefined;
    return this._canOpen || inHost
      ? html`<button
          class="link ${cls}"
          data-tip=${inHost ? 'Open in Sources' : tip}
          @click=${open}
        >
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
    const allWarnings = d.warnings ?? [];
    const warnings = allWarnings.filter((w) => byRow(w.code, w.message));
    const docs = this._docsView(d);
    const anatomyHit =
      d.anatomy !== undefined &&
      Object.values(
        anatomyMatches(d.anatomy, (...t) => this._matches(...t))
      ).some((v) => (Array.isArray(v) ? v.includes(true) : v));
    const anyMatch =
      props.length +
        stateProps.length +
        attributes.length +
        extras.length +
        warnings.length >
        0 ||
      anatomyHit ||
      docs.anyMatch;
    const rootLabel = describeRoot(d);
    const revealer = elementRevealer();
    return html`
      <div class="head">
        <h2>
          <span class="punct">&lt;</span>${d.tagName}<span class="punct"
            >&gt;</span
          >
        </h2>
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
          allWarnings.length === 0
            ? nothing
            : html`<span
                class="status warned"
                data-tip="Lit warned about this component in dev mode; see Warnings below"
                >${allWarnings.length === 1 ? '1 warning' : `${allWarnings.length} warnings`}</span
              >`
        }
        ${
          d.notDefined === true
            ? html`<span
                class="status undefined"
                data-tip="No custom element is defined for this tag"
                >not defined</span
              >`
            : nothing
        }
        ${d.notLit === true ? notLitChip : nothing} ${deprecatedChip(docs.docs)}
        ${
          d.flags.hasUpdated || d.notDefined === true || d.notLit === true
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
        ${
          revealer === undefined || this._snapshot
            ? nothing
            : html`<wa-button
                class="reveal"
                data-action="reveal-in-elements"
                appearance="plain"
                size="small"
                data-tip="Reveal in the Elements panel"
                aria-label="Reveal in Elements"
                @click=${() => void revealer(d.id)}
              >
                <wa-icon name="cursor-click"></wa-icon>
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
      ${
        d.notDefined === true
          ? html`<p class="not-defined-note">
              Nothing has called
              <code>customElements.define('${d.tagName}')</code>, so the browser
              treats this as an unknown element. Check that the component's
              module is imported and the tag is spelled the same in both places.
            </p>`
          : nothing
      }
      ${
        d.notLit === true
          ? html`<p class="not-defined-note">
              Defined, but not as a Lit component, so there are no reactive
              properties or updates to show. Attributes and slots are read from
              the page.
            </p>`
          : nothing
      }
      <wa-input
        class="filter"
        size="small"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="Filter rows"
        label="Filter rows"
        with-clear
        .value=${this._query}
        @input=${this._onFilterInput}
        @wa-clear=${() => (this._query = '')}
        @keydown=${this._onFilterKeydown}
      >
        <wa-icon slot="start" name="magnifying-glass"></wa-icon>
        <wa-icon slot="clear-icon" name="x"></wa-icon>
      </wa-input>
      ${this._renderAbout(docs)}
      ${this._renderSection(
        'Warnings',
        warnings.length,
        allWarnings.length,
        html`<div class="kv">
          ${warnings.map(
            (w) =>
              html`<div class="warning">
                ${
                  w.code === ''
                    ? nothing
                    : html`<a
                        class="code"
                        href=${`https://lit.dev/msg/${w.code}`}
                        target="_blank"
                        rel="noreferrer"
                        >${w.code}</a
                      >`
                }
                <span class="text">${this._mark(w.message)}</span>
              </div>`
          )}
        </div>`
      )}
      ${d.anatomy === undefined ? nothing : this._renderAnatomy(d.anatomy, docs)}
      ${this._renderSection(
        'Properties',
        props.length,
        allProps.length,
        this._renderPropTable(props, docs.properties)
      )}
      ${this._renderSection(
        'State',
        stateProps.length,
        allState.length,
        this._renderPropTable(stateProps, docs.properties)
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
                this._describedName(a.name, docs.attributes),
                JSON.stringify(a.value),
                {
                  code: true,
                  key: attrKey(a.name),
                  // The attribute's own text, without the quotes shown.
                  copy: a.value,
                }
              )
            )}
          </div>
        `
      )}
      ${this._renderDocSections(docs)}
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
    const treeFilter =
      this._treeQuery.trim() === ''
        ? undefined
        : filterTree(this._session.roots, this._treeQuery);
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
        <wa-input
          class="tree-filter"
          size="small"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="Filter tags"
          label="Filter tags"
          with-clear
          .value=${this._treeQuery}
          @input=${this._onTreeFilterInput}
          @wa-clear=${() => (this._treeQuery = '')}
          @keydown=${this._onTreeFilterKeydown}
        >
          <wa-icon slot="start" name="magnifying-glass"></wa-icon>
          ${
            treeFilter === undefined
              ? nothing
              : html`<span
                  slot="end"
                  class="match-count"
                  data-tip="Elements that match"
                  >${treeFilter.matched.size}</span
                >`
          }
          <wa-icon slot="clear-icon" name="x"></wa-icon>
        </wa-input>
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
          role="tree"
          aria-label="Components"
          @mouseleave=${this._leaveTree}
        >
          ${
            this._error !== null
              ? html`<div class="empty">${this._error}</div>`
              : this._session.roots.length === 0
                ? this._renderEmpty()
                : treeFilter !== undefined && treeFilter.keep.size === 0
                  ? html`<div class="empty no-match">
                      No elements match “${this._treeQuery.trim()}”.
                    </div>`
                  : this._session.roots.map((n) =>
                      this._renderNode(n, 0, treeFilter)
                    )
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
