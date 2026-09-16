/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Walks the page to build the component render tree and to snapshot a single
 * element's reactive state for the inspector panel. Runs entirely in the page;
 * the results are sent over the transport as plain JSON.
 */

import {idOf} from '../timeline/identity.js';
import {serialize, typeTag} from './serialize.js';
import type {
  ElementSource,
  InspectorDetails,
  InspectorProp,
  InspectorTreeNode,
} from '../../../types/inspector.js';

const SOURCE_META_KEY = Symbol.for('@lit-labs/vite-plugin-lit#source');

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
}

/** Subset of a ReactiveElement instance/constructor we duck-type against. */
interface ReactiveElementLike extends Element {
  requestUpdate?: unknown;
  hasUpdated?: boolean;
  isUpdatePending?: boolean;
  constructor: {
    elementProperties?: Map<PropertyKey, PropertyDeclaration>;
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

/**
 * An element worth showing in the tree: an upgraded custom element that
 * duck-types as a ReactiveElement. Catches Lit components regardless of whether
 * the source-meta transform touched them, while skipping devtools' own UI.
 */
export const isInspectable = (el: Element): boolean => {
  const tag = el.tagName.toLowerCase();
  if (!tag.includes('-')) return false;
  if (tag === 'lit-source-overlay' || tag.startsWith('lit-devtools-')) {
    return false;
  }
  return typeof (el as ReactiveElementLike).requestUpdate === 'function';
};

const nodeFor = (
  el: Element,
  children: InspectorTreeNode[]
): InspectorTreeNode => {
  const meta = metaOf(el);
  return {
    id: idOf(el),
    tagName: el.tagName.toLowerCase(),
    componentName: meta?.componentName,
    source:
      meta === undefined
        ? undefined
        : {file: meta.filePath, line: meta.lineNumber},
    children,
  };
};

/**
 * Visits `el`: if it's inspectable it becomes a node whose children are the
 * inspectables nested in its shadow + light DOM; otherwise we descend, pushing
 * any inspectables we find into the current `sink` (so non-component wrappers
 * are flattened away).
 */
const visit = (el: Element, sink: InspectorTreeNode[]): void => {
  if (isInspectable(el)) {
    const children: InspectorTreeNode[] = [];
    descend(el, children);
    sink.push(nodeFor(el, children));
  } else {
    descend(el, sink);
  }
};

const descend = (el: Element, sink: InspectorTreeNode[]): void => {
  const shadow = el.shadowRoot;
  if (shadow !== null) {
    for (const child of shadow.children) visit(child, sink);
  }
  for (const child of el.children) visit(child, sink);
};

/** Build the full component render tree rooted at the document body. */
export const buildTree = (): InspectorTreeNode[] => {
  const roots: InspectorTreeNode[] = [];
  for (const child of document.body.children) visit(child, roots);
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

/** Snapshot one element's reactive properties, attributes, and flags. */
export const collectDetails = (el: Element): InspectorDetails => {
  const re = el as ReactiveElementLike;
  const declarations = re.constructor.elementProperties;
  const properties: InspectorProp[] = [];
  if (declarations !== undefined) {
    for (const [key, decl] of declarations) {
      // Reading a reactive property runs its accessor, which may throw; one bad
      // getter must not take out the whole details snapshot.
      let value: unknown;
      let threw = false;
      try {
        value = (el as unknown as Record<PropertyKey, unknown>)[key];
      } catch {
        threw = true;
      }
      properties.push({
        name: typeof key === 'symbol' ? key.toString() : String(key),
        value: threw ? '[getter threw]' : serialize(value),
        type: threw ? 'error' : typeTag(value),
        attribute: attributeName(key, decl),
        reflects: decl.reflect === true,
        state: decl.state === true,
      });
    }
  }

  const attributes = Array.from(el.attributes, (a) => ({
    name: a.name,
    value: a.value,
  }));

  const meta = metaOf(el);
  return {
    id: idOf(el),
    tagName: el.tagName.toLowerCase(),
    componentName: meta?.componentName,
    source: sourceOf(el),
    attributes,
    properties,
    flags: {
      hasUpdated: re.hasUpdated === true,
      isUpdatePending: re.isUpdatePending === true,
      hasShadowRoot: el.shadowRoot !== null,
    },
  };
};
