/**
 * Reads how an element composes its content: its render root, the slots in
 * it, the light children no slot takes, and the elements it exposes to
 * `::part()`. Passive: it reads slot assignments and never moves a node.
 *
 * The overlay ({@link ./anatomy-overlay.ts}) draws the same slots and parts
 * on the page, so the node lists it measures come from here too.
 */

import {idOf} from '../timeline/identity.js';
import {isListed} from './listed.js';
import type {
  AnatomyElementRef,
  AnatomyOrphan,
  AnatomyPart,
  AnatomySlot,
  InspectorAnatomy,
} from '../../../types/inspector.js';

/** Assigned elements listed per slot; the rest are counted. */
const MAX_SLOT_ELEMENTS = 12;

/**
 * Where the element renders. Lit's `renderRoot` reaches a closed shadow root
 * too, which `shadowRoot` hides; anything else falls back to `shadowRoot`.
 */
export const renderRootOf = (el: Element): ShadowRoot | Element | null => {
  const root = (el as {renderRoot?: unknown}).renderRoot;
  if (root instanceof ShadowRoot) return root;
  if (root === el) return el;
  return el.shadowRoot;
};

/** The element's shadow root, closed or open; `null` for light DOM or none. */
export const shadowOf = (el: Element): ShadowRoot | null => {
  const root = renderRootOf(el);
  return root instanceof ShadowRoot ? root : null;
};

const refOf = (el: Element): AnatomyElementRef => ({
  tagName: el.localName,
  ...(isListed(el) ? {id: idOf(el)} : {}),
});

const isText = (n: Node): boolean =>
  n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '';

/** The element's own slots, in document order. Nested shadow roots excluded. */
export const slotsOf = (el: Element): HTMLSlotElement[] => {
  const shadow = shadowOf(el);
  return shadow === null ? [] : Array.from(shadow.querySelectorAll('slot'));
};

/** How far `exportparts` is followed through nested components. */
const MAX_EXPORT_DEPTH = 4;

/** One name a `::part()` selector can reach on the element. */
export interface PartEntry {
  /** The names this element answers to; one name for a forwarded part. */
  names: string[];
  element: Element;
  /** Set when a nested component forwards the part with `exportparts`. */
  forwarded?: {host: Element; inner?: string};
}

/** `a, b: c` as `[inner, outer]` pairs; a bare name maps to itself. */
const parseExportParts = (value: string): [string, string][] =>
  value
    .split(',')
    .map((pair): [string, string] => {
      const [inner, outer] = pair.split(':').map((s) => s.trim());
      return [inner, outer || inner];
    })
    .filter(([inner]) => inner !== '');

interface ReachablePart {
  name: string;
  element: Element;
  forwarded?: {host: Element; inner?: string};
}

/** The `[part]` names on elements directly inside `shadow`. */
const ownReachable = (shadow: ShadowRoot): ReachablePart[] => {
  const out: ReachablePart[] = [];
  for (const element of shadow.querySelectorAll('[part]')) {
    for (const name of (element.getAttribute('part') ?? '').split(/\s+/)) {
      if (name !== '') out.push({name, element});
    }
  }
  return out;
};

/** The parts the nested component `host` forwards with `exportparts`. */
const forwardedFrom = (host: Element, depth: number): ReachablePart[] => {
  const inside = shadowOf(host);
  if (inside === null) return [];
  const out: ReachablePart[] = [];
  const nested = reachableParts(inside, depth + 1);
  for (const [inner, outer] of parseExportParts(
    host.getAttribute('exportparts') ?? ''
  )) {
    for (const part of nested) {
      if (part.name !== inner) continue;
      out.push({
        name: outer,
        element: part.element,
        forwarded: {host, ...(inner !== outer ? {inner} : {})},
      });
    }
  }
  return out;
};

/**
 * Every part name visible from inside `shadow`: its own `[part]` elements,
 * then those its nested components forward with `exportparts`.
 */
const reachableParts = (shadow: ShadowRoot, depth: number): ReachablePart[] => {
  const out = ownReachable(shadow);
  if (depth >= MAX_EXPORT_DEPTH) return out;
  for (const host of shadow.querySelectorAll('[exportparts]')) {
    out.push(...forwardedFrom(host, depth));
  }
  return out;
};

/**
 * The element's own `part` elements, then the parts its nested components
 * forward through `exportparts`. Nested shadow roots are otherwise excluded.
 */
export const partsOf = (el: Element): PartEntry[] => {
  const shadow = shadowOf(el);
  if (shadow === null) return [];
  const own: PartEntry[] = [];
  const forwarded: PartEntry[] = [];
  const byElement = new Map<Element, PartEntry>();
  for (const p of reachableParts(shadow, 0)) {
    if (p.forwarded !== undefined) {
      forwarded.push({
        names: [p.name],
        element: p.element,
        forwarded: p.forwarded,
      });
      continue;
    }
    // Every `[part]` of this root, grouped by element in document order.
    let entry = byElement.get(p.element);
    if (entry === undefined) {
      entry = {names: [], element: p.element};
      byElement.set(p.element, entry);
      own.push(entry);
    }
    entry.names.push(p.name);
  }
  return [...own, ...forwarded];
};

/**
 * What a slot puts on the page: its assigned nodes flattened through
 * forwarded slots, or its fallback content when nothing is assigned.
 */
export const renderedNodesOf = (slot: HTMLSlotElement): Node[] =>
  slot.assignedNodes({flatten: true});

const describeSlot = (
  slot: HTMLSlotElement,
  seen: Set<string>
): AnatomySlot => {
  const direct = slot.assignedNodes();
  const duplicate = seen.has(slot.name);
  seen.add(slot.name);
  if (direct.length === 0) {
    const fallback = Array.from(slot.childNodes).some(
      (n) => n instanceof Element || isText(n)
    );
    return {
      name: slot.name,
      status: fallback ? 'fallback' : 'empty',
      elements: [],
      moreElements: 0,
      textNodes: 0,
      forwarded: false,
      duplicate,
    };
  }
  const flat = renderedNodesOf(slot);
  const elements = flat.filter((n): n is Element => n instanceof Element);
  return {
    name: slot.name,
    status: 'assigned',
    elements: elements.slice(0, MAX_SLOT_ELEMENTS).map(refOf),
    moreElements: Math.max(0, elements.length - MAX_SLOT_ELEMENTS),
    textNodes: flat.filter(isText).length,
    forwarded: direct.some((n) => n instanceof HTMLSlotElement),
    duplicate,
  };
};

const describePart = ({names, element, forwarded}: PartEntry): AnatomyPart => ({
  names,
  tagName: element.localName,
  ...(forwarded !== undefined
    ? {
        forwarded: {
          from: forwarded.host.localName,
          ...(forwarded.inner !== undefined ? {inner: forwarded.inner} : {}),
        },
      }
    : {}),
});

/** Snapshot an element's anatomy, or `undefined` when it has no render root. */
export const collectAnatomy = (el: Element): InspectorAnatomy | undefined => {
  const root = renderRootOf(el);
  if (root === null) return undefined;
  if (!(root instanceof ShadowRoot)) {
    return {
      renderRoot: 'light',
      slots: [],
      orphans: [],
      orphanText: 0,
      parts: [],
    };
  }

  const seen = new Set<string>();
  const slots = slotsOf(el);
  // Built from the slots rather than each child's `assignedSlot`, which is
  // null for every child of a closed shadow root.
  const taken = new Set<Node>();
  for (const slot of slots) {
    for (const n of slot.assignedNodes()) taken.add(n);
  }
  const orphans: AnatomyOrphan[] = [];
  let orphanText = 0;
  for (const child of el.childNodes) {
    if (taken.has(child)) continue;
    if (child instanceof Element) {
      orphans.push({...refOf(child), slot: child.getAttribute('slot') ?? ''});
    } else if (isText(child)) {
      orphanText++;
    }
  }

  return {
    renderRoot: 'shadow',
    mode: root.mode,
    delegatesFocus: root.delegatesFocus,
    slots: slots.map((s) => describeSlot(s, seen)),
    orphans,
    orphanText,
    parts: partsOf(el).map(describePart),
  };
};
