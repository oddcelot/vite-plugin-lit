/**
 * Shared types and channel/path constants for the Components inspector.
 *
 * The inspector lets the DevTools panel show a hierarchical tree of the Lit
 * components on the page plus a detail view (reactive properties, internal
 * state, attributes, source) of a selected element. The panel can't touch the
 * page DOM directly (separate iframe document), so everything flows over the
 * existing transport: panel → server (POST {@link INSPECT_PATH}) → app runtime
 * (HMR {@link INSPECT_CMD_CHANNEL}); app → server (HMR
 * {@link INSPECT_DATA_CHANNEL}) → panel (SSE `event: {@link INSPECT_SSE_EVENT}`).
 *
 * Elements are referenced across the boundary by the stable numeric id from the
 * timeline's `idOf()` WeakMap, so a tree node, a details payload, and an
 * inspector pick all agree on identity.
 */

export interface ElementSource {
  file: string;
  line: number;
  /** 1-based column, when known (call sites carry one; declarations don't). */
  column?: number;
  /**
   * The original source's absolute URL as DevTools names it, when the
   * location was resolved through a page's sourcemap (the extension, on a
   * page without the plugin). Opens in the Sources panel, not an editor.
   */
  url?: string;
  /** The generated script position the location was mapped from. */
  generated?: GeneratedFrame;
}

/**
 * One frame of a `customElements.define` call's stack, as the browser printed
 * it: a script URL with a 1-based line and column in the generated code.
 */
export interface GeneratedFrame {
  url: string;
  line: number;
  column: number;
}

/** A node in the component render tree (one inspectable Lit element). */
export interface InspectorTreeNode {
  id: number;
  tagName: string;
  componentName?: string;
  /** Where the component class is declared. */
  source?: ElementSource;
  /**
   * Where this instance was written, in an `html` template or an HTML entry
   * file, from the `data-lit-source` attribute the dev transform stamps.
   * Absent for elements created any other way (`createElement`, a dynamic
   * tag).
   */
  callSite?: ElementSource;
  /**
   * Set when the tag is a custom element name nothing has defined: a missing
   * import, a typo, or a chunk that has not loaded. It has no Lit state.
   */
  notDefined?: true;
  /**
   * How many distinct Lit dev-mode warnings name this component. Lit issues
   * each once per page, so this is per tag/class, not per instance. Absent
   * when there are none.
   */
  warnings?: number;
  children: InspectorTreeNode[];
  /**
   * Set only when a depth limit pruned this node's children: how many
   * direct children were dropped. Absent on the unpruned tree.
   */
  hiddenChildren?: number;
}

/** A reactive-property option that departs from Lit's default. */
export type InspectorPropOption =
  | 'hasChanged'
  | 'converter'
  | 'noAccessor'
  | 'useDefault';

/** One reactive property (or internal `@state`) of an inspected element. */
export interface InspectorProp {
  name: string;
  /** Serialized, depth-limited preview of the current value. */
  value: string;
  /** A short type tag (`string`, `number`, `Array(3)`, `MyClass`, …). */
  type: string;
  /** The reflected attribute name, or `false` when `attribute: false`. */
  attribute: string | false;
  /** Whether the property reflects to its attribute. */
  reflects: boolean;
  /** Whether it's an internal `@state()` (no public attribute). */
  state: boolean;
  /**
   * Declaration options set beyond Lit's defaults: a custom `hasChanged` or
   * `converter`, `noAccessor`, `useDefault`. Absent when none is set, and
   * from an older runtime. Presence only; the functions are never called.
   */
  options?: InspectorPropOption[];
  /**
   * Whether the value has children to list with an `expand` command. Absent
   * from an older runtime, which cannot answer one.
   */
  expandable?: boolean;
}

/**
 * One piece of non-reactive instance state: a reactive controller, a
 * `@lit/task`, a signal, or a plain class field.
 */
export interface InspectorExtra {
  kind: 'controller' | 'task' | 'signal' | 'field' | 'context';
  /**
   * The own-field name when the controller or signal is stored in one, else
   * its constructor name.
   */
  name: string;
  /**
   * Serialized preview of the value: a task's value or error, a signal's
   * value, a field's value.
   */
  value: string;
  /** A short type tag, or the constructor name for a controller. */
  type: string;
  /** A task's status (`initial`, `pending`, `complete`, `error`). */
  status?: string;
  /** As {@link InspectorProp.expandable}. */
  expandable?: boolean;
  /** `@lit/context` role of a `context` extra, and how it links to others. */
  context?: InspectorContext;
}

/**
 * A `@lit/context` provider or consumer on the element: the context key as
 * written, and the elements on the other side of it.
 */
export interface InspectorContext {
  role: 'provider' | 'consumer';
  /** The context key: a Symbol's description, a string, else a preview. */
  key: string;
  /** Consumer only: the provider that answered it, when one is found. */
  provider?: AnatomyElementRef;
  /**
   * Provider only: the consumers that subscribed to it, at most 12. A
   * consumer that did not ask for updates is not recorded by the provider.
   */
  consumers?: AnatomyElementRef[];
  /** Subscribed consumers past the first 12. */
  moreConsumers?: number;
}

/**
 * One step into a value: an object key, or the position of an item in an
 * array, `Map` or `Set` (iteration order for the latter two).
 */
export type ValueSegment = string | number;

/**
 * Where a value sits on an element: a details row, by section and name, then
 * the steps from that row's value down to the one meant.
 */
export interface ValuePath {
  section: 'prop' | 'extra';
  name: string;
  keys: ValueSegment[];
}

/** One child of an expanded value. */
export interface ValueChild {
  /** The key, index or (for a `Map`) serialized key, as shown. */
  label: string;
  /** The segment that reaches this child from its parent. */
  key: ValueSegment;
  /** Whether `label` is a `Map` key, shown as `label => value`. */
  entry?: boolean;
  value: string;
  type: string;
  expandable: boolean;
}

/** An element named in an anatomy entry; `id` is set when it is inspectable. */
export interface AnatomyElementRef {
  tagName: string;
  id?: number;
}

/** One `<slot>` in an element's shadow root. */
export interface AnatomySlot {
  /** The slot's `name`, `''` for the default slot. */
  name: string;
  /**
   * `assigned` when light children land in it, `fallback` when it renders
   * its own content instead, `empty` when it renders nothing at all.
   */
  status: 'assigned' | 'fallback' | 'empty';
  /** Assigned elements, flattened through forwarded slots, at most 12. */
  elements: AnatomyElementRef[];
  /** Assigned elements past the first 12. */
  moreElements: number;
  /** Assigned text nodes that are not just whitespace. */
  textNodes: number;
  /** The content arrives through a slot of an enclosing shadow root. */
  forwarded: boolean;
  /**
   * An earlier slot has the same name, so this one never receives content.
   */
  duplicate: boolean;
}

/** A light child that matches no slot, so the browser never renders it. */
export interface AnatomyOrphan extends AnatomyElementRef {
  /** The `slot` attribute it asks for, `''` for the default slot. */
  slot: string;
}

/**
 * An element in the shadow root that exposes itself to `::part()`, or one
 * deeper in a nested component's shadow root that is forwarded up.
 */
export interface AnatomyPart {
  names: string[];
  tagName: string;
  /**
   * A nested component forwards this part with `exportparts`: `from` is its
   * tag, `inner` the part's name inside it when `exportparts` renames it.
   */
  forwarded?: {from: string; inner?: string};
}

/**
 * How an element composes its content: where it renders, its slots, the
 * light children no slot takes, and its `::part` exports.
 */
export interface InspectorAnatomy {
  /** `light` when `createRenderRoot` returns the element itself. */
  renderRoot: 'shadow' | 'light';
  /** The shadow root's mode; absent for light DOM. */
  mode?: 'open' | 'closed';
  delegatesFocus?: boolean;
  slots: AnatomySlot[];
  orphans: AnatomyOrphan[];
  /** Light text that matches no slot (no default slot to take it). */
  orphanText: number;
  parts: AnatomyPart[];
}

/**
 * One region of the anatomy overlay: slot `index` or part `index`, in the
 * order {@link InspectorAnatomy} lists them.
 */
export interface AnatomyFocus {
  kind: 'slot' | 'part';
  index: number;
}

/**
 * Colours the anatomy overlay gives slots and parts, in order. The details
 * pane uses the same list, so a slot row and its region on the page match.
 */
export const ANATOMY_COLORS = [
  '#4d63ff',
  '#e8590c',
  '#2f9e44',
  '#c2255c',
  '#1098ad',
  '#9c36b5',
  '#f08c00',
  '#5c940d',
] as const;

/**
 * A Lit dev-mode warning that names this element's tag or component class
 * (`change-in-update`, class-field shadowing, …). Lit issues each message once
 * per page, so it describes the component, not only this instance.
 */
export interface InspectorWarning {
  /** Lit's message code, `''` when Lit gave none; see lit.dev/msg/<code>. */
  code: string;
  message: string;
}

/** Full detail snapshot for a single inspected element. */
export interface InspectorDetails {
  id: number;
  tagName: string;
  componentName?: string;
  /** Where the component class is declared. */
  source?: ElementSource;
  /** Where this instance was written in a template; see {@link InspectorTreeNode.callSite}. */
  callSite?: ElementSource;
  /**
   * The stack of the `customElements.define` call that registered this
   * element's class, innermost first, when the plugin stamped no `source`
   * and the runtime saw the call (the extension's, which installs before the
   * page defines anything). A host with the page's sourcemaps resolves it
   * into `source`.
   */
  defineFrames?: GeneratedFrame[];
  /** As {@link InspectorTreeNode.notDefined}. */
  notDefined?: true;
  attributes: Array<{name: string; value: string}>;
  properties: InspectorProp[];
  flags: {
    hasUpdated: boolean;
    isUpdatePending: boolean;
    hasShadowRoot: boolean;
  };
  /** Render root, slots and parts. Absent for an element with no render root. */
  anatomy?: InspectorAnatomy;
  /**
   * Non-reactive instance state: controllers, tasks, signals, plain fields.
   * Absent when there is none.
   */
  extras?: InspectorExtra[];
  /**
   * Lit dev-mode warnings about this component. Absent when there are none,
   * and always absent under a production build of Lit, which issues none.
   */
  warnings?: InspectorWarning[];
}

/**
 * Loaded versions per Lit package (`lit-html`, `lit-element`,
 * `@lit/reactive-element`), one entry per loaded copy; more than one entry
 * means duplicates. The `lit` package itself pushes no version, and its
 * version differs from `lit-element`'s, so each package is named.
 */
export type LitPackageVersions = Record<string, string[]>;

/** App runtime → panel messages, carried on SSE `event: inspect`. */
export type InspectorMessage =
  /**
   * The runtime came online; the panel should (re)request the tree. Carries
   * what the page can say about itself, so an empty tree can be explained.
   * Every field is optional: an older runtime sends a bare `ready`.
   */
  | {
      type: 'ready';
      litPackages?: LitPackageVersions;
      topFrame?: boolean;
      /** Whether the browser draws the Chrome Performance tracks. */
      chromeTracks?: boolean;
    }
  | {type: 'tree'; roots: InspectorTreeNode[]}
  | {type: 'details'; details: InspectorDetails}
  /** The requested element id couldn't be resolved (removed / GC'd). */
  | {type: 'gone'; id: number}
  /** An inspect-mode overlay pick — select this element in the panel. */
  | {type: 'pick'; id: number}
  /**
   * The children of the value at `path` on element `id`, answering an
   * `expand` command. `children` is null when the path no longer resolves;
   * `more` counts children past the ones listed.
   */
  | {
      type: 'expanded';
      id: number;
      path: ValuePath;
      children: ValueChild[] | null;
      more?: number;
    };

/** Panel → app runtime commands, POSTed to {@link INSPECT_PATH}. */
export type InspectorCommand =
  | {type: 'tree'}
  | {type: 'details'; id: number}
  /** Keep pushing fresh details for `id` as it updates; `null` stops. */
  | {type: 'watch'; id: number | null}
  /** Outline element `id` in the page on tree hover; `null` clears it. */
  | {type: 'highlight'; id: number | null}
  /**
   * Outline every element in `ids` at once, replacing the single hover
   * outline; an empty list clears them.
   */
  | {type: 'highlight-all'; ids: number[]}
  /** Scroll element `id` into view in the page and outline it briefly. */
  | {type: 'reveal'; id: number}
  /** List the children of the value at `path` on element `id`. */
  | {type: 'expand'; id: number; path: ValuePath}
  /** Draw element `id`'s slots and parts on the page; `null` clears it. */
  | {type: 'anatomy'; id: number | null}
  /**
   * Emphasise one region of the anatomy overlay and fade the rest; `null` shows
   * them all evenly again.
   */
  | {type: 'anatomy-focus'; focus: AnatomyFocus | null}
  /**
   * Opt-in live tree: when enabled, the runtime watches the DOM and pushes a
   * fresh `tree` message whenever the component hierarchy changes. Off by
   * default (the panel otherwise refreshes on demand / on pick).
   */
  | {type: 'observe'; enabled: boolean}
  /**
   * Start the overlay's inspect-mode picker (the panel's "Pick" button). Handled
   * by the server (it broadcasts {@link INSPECT_OVERLAY_TOGGLE_CHANNEL}), not the
   * app runtime, so it never reaches the runtime's command handler.
   */
  | {type: 'pick'};

/**
 * The `globalThis` key under which the page runtime exposes `elementById`.
 * DevTools' `inspectedWindow.eval` runs in the page's main world and can only
 * pass the panel's numeric id as source text, so it reaches the node through
 * this to hand it to `inspect()`.
 */
export const ELEMENT_BY_ID_KEY = Symbol.for(
  '@oddsquad/vite-plugin-lit#element-by-id'
);

/** HMR channel the server uses to forward a panel command to the app runtime. */
export const INSPECT_CMD_CHANNEL = 'lit:inspect:cmd';

/** HMR channel the app runtime uses to push an {@link InspectorMessage}. */
export const INSPECT_DATA_CHANNEL = 'lit:inspect:data';

/** Vite HMR channel the DevTools "inspect element" command broadcasts on. */
export const INSPECT_OVERLAY_TOGGLE_CHANNEL = 'lit-devtools:toggle-inspect';

/** POST endpoint the panel uses to send an {@link InspectorCommand}. */
export const INSPECT_PATH = '/__lit-devtools-inspect';

/** Named SSE event the server relays {@link InspectorMessage}s to the panel on. */
export const INSPECT_SSE_EVENT = 'inspect';
