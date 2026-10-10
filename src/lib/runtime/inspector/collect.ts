/**
 * Walks the page to build the component render tree and to snapshot a single
 * element's reactive state for the inspector panel. Runs entirely in the page;
 * the results are sent over the transport as plain JSON.
 */

import {childrenOf, isExpandable, stepInto} from './inspect-value.js';
import {idOf} from '../timeline/identity.js';
import {warningsFor} from '../timeline/lit-warnings.js';
import {
  isForeignElement,
  isInspectable,
  isListed,
  isUndefinedElement,
} from './listed.js';
import {collectAnatomy} from './anatomy.js';
import {collectExtras, extraValue} from './extras.js';
import {serialize, typeTag} from './serialize.js';
import type {
  ElementSource,
  InspectorDetails,
  InspectorProp,
  InspectorPropOption,
  InspectorTreeNode,
  ValueChild,
  ValuePath,
} from '../../../types/inspector.js';
import {CALL_SITE_ATTR, SOURCE_META_KEY, readCallSite} from '../source-meta.js';
import {defineFramesOf, defineIdOf} from '../define-sites.js';

interface LitSourceMeta {
  filePath: string;
  lineNumber: number;
  componentName: string;
}

/** Subset of ReactiveElement's `PropertyDeclaration` we read. */
interface PropertyDeclaration {
  attribute?: boolean | string;
  reflect?: boolean;
  state?: boolean;
  hasChanged?: unknown;
  converter?: unknown;
  noAccessor?: boolean;
  useDefault?: boolean;
}

/** Subset of a ReactiveElement instance/constructor we duck-type against. */
interface ReactiveElementLike extends Element {
  requestUpdate?: unknown;
  hasUpdated?: boolean;
  isUpdatePending?: boolean;
  constructor: {
    elementProperties?: Map<PropertyKey, PropertyDeclaration>;
    getPropertyOptions?: (name: PropertyKey) => PropertyDeclaration;
    [SOURCE_META_KEY]?: LitSourceMeta;
  };
}

const metaOf = (el: Element): LitSourceMeta | undefined =>
  (el as ReactiveElementLike).constructor[SOURCE_META_KEY];

const sourceOf = (el: Element): ElementSource | undefined => {
  const meta = metaOf(el);
  return meta === undefined
    ? undefined
    : {file: meta.filePath, line: meta.lineNumber};
};

const callSiteOf = (el: Element): ElementSource | undefined => {
  const site = readCallSite(el);
  return site === undefined
    ? undefined
    : {file: site.filePath, line: site.lineNumber, column: site.columnNumber};
};

/**
 * The id of the nearest element the tree lists (see {@link isListed}) at or
 * above `node`: itself, its ancestors, and past each shadow root to its host.
 * `undefined` when none encloses it.
 */
export const listedIdOf = (node: unknown): number | undefined => {
  let el: Element | null =
    node instanceof Element
      ? node
      : node instanceof Node
        ? node.parentElement
        : null;
  while (el !== null) {
    if (isListed(el)) return idOf(el);
    const root = el.getRootNode();
    el = el.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return undefined;
};

const nodeFor = (
  el: Element,
  children: InspectorTreeNode[],
  flag?: 'notDefined' | 'notLit'
): InspectorTreeNode => {
  const meta = metaOf(el);
  // No stamp: a host that can map the define call's stack fills `source`.
  const defineId = meta === undefined ? defineIdOf(el.constructor) : undefined;
  const warned = warningsFor(
    el.localName,
    (el.constructor as {name?: string}).name
  ).length;
  return {
    id: idOf(el),
    ...(flag !== undefined ? {[flag]: true} : {}),
    ...(warned > 0 ? {warnings: warned} : {}),
    tagName: el.tagName.toLowerCase(),
    componentName: meta?.componentName,
    source:
      meta === undefined
        ? undefined
        : {file: meta.filePath, line: meta.lineNumber},
    ...(defineId !== undefined ? {defineId} : {}),
    callSite: callSiteOf(el),
    children,
  };
};

/**
 * Visits `el`: if it's inspectable it becomes a node whose children are the
 * inspectables nested in its shadow + light DOM; otherwise we descend, pushing
 * any inspectables we find into the current `sink` (so non-component wrappers
 * are flattened away).
 */
const visit = (
  el: Element,
  sink: InspectorTreeNode[],
  onUndefined?: (tag: string) => void
): void => {
  if (isInspectable(el)) {
    const children: InspectorTreeNode[] = [];
    descend(el, children, onUndefined);
    sink.push(nodeFor(el, children));
  } else if (isUndefinedElement(el)) {
    // Kept in its real position so the tree shows where the missing component
    // sits; light children are still walked, they may be components.
    onUndefined?.(el.localName);
    const children: InspectorTreeNode[] = [];
    descend(el, children, onUndefined);
    sink.push(nodeFor(el, children, 'notDefined'));
  } else if (isForeignElement(el)) {
    const children: InspectorTreeNode[] = [];
    descend(el, children, onUndefined);
    sink.push(nodeFor(el, children, 'notLit'));
  } else {
    descend(el, sink, onUndefined);
  }
};

const descend = (
  el: Element,
  sink: InspectorTreeNode[],
  onUndefined?: (tag: string) => void
): void => {
  const shadow = el.shadowRoot;
  if (shadow !== null) {
    for (const child of shadow.children) visit(child, sink, onUndefined);
  }
  for (const child of el.children) visit(child, sink, onUndefined);
};

/**
 * Build the full component render tree rooted at the document body.
 * `onUndefined` hears the tag of each element that has no definition yet, so
 * the caller can rebuild once one is defined.
 */
export const buildTree = (
  onUndefined?: (tag: string) => void
): InspectorTreeNode[] => {
  const roots: InspectorTreeNode[] = [];
  for (const child of document.body.children) visit(child, roots, onUndefined);
  return roots;
};

const attributeName = (
  key: PropertyKey,
  decl: PropertyDeclaration
): string | false => {
  if (decl.attribute === false) return false;
  if (typeof decl.attribute === 'string') return decl.attribute;
  return String(key).toLowerCase();
};

/**
 * The declaration options that differ from Lit's defaults, by name. Only the
 * presence of a function is detected, never what it does: `hasChanged` and
 * `converter` count when they are not the ones Lit fills in for a bare
 * `@property()`, which `getPropertyOptions` returns for an undeclared name.
 */
const optionsOf = (
  ctor: ReactiveElementLike['constructor'],
  decl: PropertyDeclaration
): InspectorPropOption[] => {
  const base = ctor.getPropertyOptions?.(Symbol('lit-devtools-default'));
  const out: InspectorPropOption[] = [];
  if (decl.hasChanged != null && decl.hasChanged !== base?.hasChanged) {
    out.push('hasChanged');
  }
  if (decl.converter != null && decl.converter !== base?.converter) {
    out.push('converter');
  }
  if (decl.noAccessor === true) out.push('noAccessor');
  if (decl.useDefault === true) out.push('useDefault');
  return out;
};

/** One declared reactive property, read without trusting its getter. */
const propOf = (
  el: Element,
  key: PropertyKey,
  decl: PropertyDeclaration
): InspectorProp => {
  // Reading a reactive property runs its accessor, which may throw; one bad
  // getter must not take out the whole details snapshot.
  let value: unknown;
  let threw = false;
  try {
    value = (el as unknown as Record<PropertyKey, unknown>)[key];
  } catch {
    threw = true;
  }
  const options = optionsOf((el as ReactiveElementLike).constructor, decl);
  return {
    name: typeof key === 'symbol' ? key.toString() : String(key),
    value: threw ? '[getter threw]' : serialize(value),
    type: threw ? 'error' : typeTag(value),
    attribute: attributeName(key, decl),
    reflects: decl.reflect === true,
    state: decl.state === true,
    ...(options.length > 0 ? {options} : {}),
    ...(!threw && isExpandable(value) ? {expandable: true} : {}),
  };
};

const propertiesOf = (el: Element): InspectorProp[] => {
  const declarations = (el as ReactiveElementLike).constructor
    .elementProperties;
  const properties: InspectorProp[] = [];
  if (declarations === undefined) return properties;
  for (const [key, decl] of declarations) {
    properties.push(propOf(el, key, decl));
  }
  return properties;
};

/** The call-site stamp is ours, not the author's: it has its own field. */
const attributesOf = (el: Element): InspectorDetails['attributes'] =>
  Array.from(el.attributes, (a) => ({name: a.name, value: a.value})).filter(
    (a) => a.name !== CALL_SITE_ATTR
  );

/** What marks the element as not a plain Lit component, when it is one. */
const statusOf = (
  el: Element,
  source: InspectorDetails['source']
): Partial<InspectorDetails> => {
  // No stamp: the define call's stack, for a host that can map it.
  const defineFrames =
    source === undefined ? defineFramesOf(el.constructor) : undefined;
  return {
    ...(defineFrames !== undefined ? {defineFrames} : {}),
    ...(isUndefinedElement(el) ? {notDefined: true} : {}),
    ...(isForeignElement(el) ? {notLit: true} : {}),
  };
};

/** The sections that are present only when they have something to say. */
const insightsOf = (el: Element): Partial<InspectorDetails> => {
  const extras = collectExtras(el);
  const anatomy = collectAnatomy(el);
  const warnings = warningsFor(
    el.localName,
    (el.constructor as {name?: string}).name
  ).map(({code, message}) => ({code, message}));
  return {
    ...(anatomy !== undefined ? {anatomy} : {}),
    ...(extras.length > 0 ? {extras} : {}),
    ...(warnings.length > 0 ? {warnings} : {}),
  };
};

/** Snapshot one element's reactive properties, attributes, and flags. */
export const collectDetails = (el: Element): InspectorDetails => {
  const re = el as ReactiveElementLike;
  const meta = metaOf(el);
  const source = sourceOf(el);
  return {
    id: idOf(el),
    tagName: el.tagName.toLowerCase(),
    componentName: meta?.componentName,
    source,
    callSite: callSiteOf(el),
    ...statusOf(el, source),
    attributes: attributesOf(el),
    properties: propertiesOf(el),
    flags: {
      hasUpdated: re.hasUpdated === true,
      isUpdatePending: re.isUpdatePending === true,
      hasShadowRoot: el.shadowRoot !== null,
    },
    ...insightsOf(el),
  };
};

/**
 * Answer an `expand` command: the children of the value at `path` on `el`,
 * or null when a step no longer resolves (the value changed shape since the
 * panel saw it). Only declared reactive properties and listed extras are
 * reachable, so a path cannot read arbitrary fields.
 */
export const expandPath = (
  el: Element,
  path: ValuePath
): {children: ValueChild[]; more: number} | null => {
  let at: {value: unknown} | undefined;
  if (path.section === 'prop') {
    const declared = (el as ReactiveElementLike).constructor.elementProperties;
    if (declared?.has(path.name) !== true) return null;
    try {
      at = {value: (el as unknown as Record<string, unknown>)[path.name]};
    } catch {
      return null;
    }
  } else {
    at = extraValue(el, path.name);
  }
  for (const key of path.keys) {
    if (at === undefined) return null;
    at = stepInto(at.value, key);
  }
  return at === undefined ? null : childrenOf(at.value);
};
