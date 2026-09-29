/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Carries child element state across a template re-instantiation.
 *
 * When a hot patch changes a template's text, lit-html sees a new template,
 * clones fresh DOM and swaps it in: every custom element inside the edited
 * template is re-created and starts from its defaults. For a short window
 * after a hot patch this module pairs each element dropped from a root with
 * the next freshly created element of the same tag connected in that root
 * (FIFO, i.e. document order), then either copies the old element's state
 * onto the new one (`'transfer'`) or, where the new element carries no
 * bindings, puts the old element back in its place (`'reuse'`).
 *
 * Dependency-free and duck-typed like `patch.ts`. The lit-html internals it
 * reads (`_$litPart$`, `_$committedValue`, `_$template`, `_$parts`,
 * `_$startNode`, `_$endNode`) are looked up by their development names first
 * and then by the stable minified names lit's prod build gives them
 * (`_$AH`, `_$AD`, `_$AV`, `_$AA`, `_$AB`). Every access is guarded; when the
 * part tree can't be read, transfer skips only attribute-driven keys and
 * reuse falls back to transfer.
 */

export type ChildStateMode = 'reset' | 'transfer' | 'reuse';

/** `Symbol.for` description prefix of the dev-only `#private` rewrite. */
export const PRIVATE_KEY_PREFIX = '@oddsquad/vite-plugin-lit#private:';

/** Hard cap on how long a transfer window stays open. */
export const WINDOW_CAP_MS = 1000;

const ATTRIBUTE_PART = 1;
const CHILD_PART = 2;
const PROPERTY_PART = 3;
const BOOLEAN_PART = 4;

/** Dev name, then the stable minified name from lit-html's prod build. */
const COMMITTED = ['_$committedValue', '_$AH'] as const;
const TEMPLATE = ['_$template', '_$AD'] as const;
const PARTS = ['_$parts', '_$AV'] as const;
const START = ['_$startNode', '_$AA'] as const;
const END = ['_$endNode', '_$AB'] as const;
const LIT_PART = '_$litPart$';

/** Duck-typed lit-html part. */
export interface PartLike {
  type: number;
  element?: unknown;
  name?: unknown;
}

/** Duck-typed element the window works with. */
export type ElementLike = HTMLElement & {
  renderRoot?: unknown;
  hasUpdated?: boolean;
  updateComplete?: unknown;
};

interface CtorLike {
  elementProperties?: Map<PropertyKey, {attribute?: unknown} | undefined>;
  __attributeToPropertyMap?: unknown;
}

const internal = (
  o: unknown,
  [dev, prod]: readonly [string, string]
): unknown => {
  if (o === null || typeof o !== 'object') {
    return undefined;
  }
  const r = o as Record<string, unknown>;
  return dev in r ? r[dev] : r[prod];
};

const isPart = (p: unknown): p is PartLike =>
  p !== null &&
  typeof p === 'object' &&
  typeof (p as PartLike).type === 'number';

const MAX_PARTS = 100_000;

/** Pushes `part` and, through child parts' committed values, every part below. */
const walkParts = (part: PartLike, out: PartLike[]): void => {
  if (out.length > MAX_PARTS) {
    throw new Error('part tree too large');
  }
  out.push(part);
  if (part.type !== CHILD_PART) {
    return;
  }
  const value = internal(part, COMMITTED);
  if (Array.isArray(value)) {
    // An iterable's committed value is an array of ChildParts.
    for (const child of value) {
      if (isPart(child)) {
        walkParts(child, out);
      }
    }
    return;
  }
  const parts = internal(value, PARTS);
  if (Array.isArray(parts) && internal(value, TEMPLATE) !== undefined) {
    for (const child of parts) {
      // Entries may be undefined (parts removed by the polyfill/hydration).
      if (isPart(child)) {
        walkParts(child, out);
      }
    }
  }
};

/**
 * Every lit-html part rendered into the tree `el` lives in: the parts of each
 * render container (`_$litPart$`) among `el`'s ancestors up to its root.
 * `undefined` when `el` isn't in a tree or the walk hits a surprise.
 */
export const partsAround = (el: Node): PartLike[] | undefined => {
  try {
    const out: PartLike[] = [];
    let node: Node | null = el.parentNode;
    if (node === null) {
      return undefined;
    }
    while (node !== null) {
      const root = (node as unknown as Record<string, unknown>)[LIT_PART];
      if (isPart(root)) {
        walkParts(root, out);
      }
      node = node.parentNode;
    }
    return out;
  } catch {
    return undefined;
  }
};

/** Attribute name → reactive property key for an element's class. */
const attributeMap = (ctor: CtorLike): Map<string, PropertyKey> => {
  // Dev builds keep the name; prod mangles it, so rebuild from options.
  const own = ctor.__attributeToPropertyMap;
  if (own instanceof Map) {
    return own as Map<string, PropertyKey>;
  }
  const map = new Map<string, PropertyKey>();
  const props = ctor.elementProperties;
  if (!(props instanceof Map)) {
    return map;
  }
  for (const [key, options] of props) {
    const attribute = options?.attribute;
    if (attribute === false) {
      continue;
    }
    if (typeof attribute === 'string') {
      map.set(attribute, key);
    } else if (typeof key === 'string') {
      map.set(key.toLowerCase(), key);
    }
  }
  return map;
};

const propertyKeys = (ctor: CtorLike | undefined): PropertyKey[] => {
  const props = ctor?.elementProperties;
  return props instanceof Map ? [...props.keys()] : [];
};

/**
 * Reactive property keys the new element already got from its template:
 * keys whose attribute is present on it (static attributes), plus, when the
 * part tree could be read, keys bound by a property, boolean or attribute
 * part targeting it.
 */
export const templateDrivenKeys = (
  el: ElementLike,
  parts: readonly PartLike[] | undefined
): Set<PropertyKey> => {
  const keys = new Set<PropertyKey>();
  const ctor = el.constructor as CtorLike;
  const attrs = attributeMap(ctor);
  try {
    for (const attr of Array.from(el.attributes)) {
      const key = attrs.get(attr.name.toLowerCase());
      if (key !== undefined) {
        keys.add(key);
      }
    }
  } catch {
    // No attributes to read.
  }
  for (const part of parts ?? []) {
    if (part.element !== el || typeof part.name !== 'string') {
      continue;
    }
    if (part.type === PROPERTY_PART) {
      keys.add(part.name);
    } else if (part.type === ATTRIBUTE_PART || part.type === BOOLEAN_PART) {
      keys.add(attrs.get(part.name.toLowerCase()) ?? part.name);
    }
  }
  return keys;
};

/** Own symbol keys of `el` minted by the dev-only `#private` rewrite. */
export const privateKeys = (el: object): symbol[] =>
  Object.getOwnPropertySymbols(el).filter((sym) =>
    (Symbol.keyFor(sym) ?? '').startsWith(PRIVATE_KEY_PREFIX)
  );

/**
 * Copies `from`'s state onto `to`: reactive properties not driven by `to`'s
 * template, and the `#private` members the dev rewrite turned into
 * `Symbol.for` keys. Nothing else — Lit's own bookkeeping lives in string
 * keys and must stay per-instance.
 */
export const transferState = (
  from: ElementLike,
  to: ElementLike,
  parts: readonly PartLike[] | undefined
): void => {
  const skip = templateDrivenKeys(to, parts);
  const keys = new Set<PropertyKey>([
    ...propertyKeys(to.constructor as CtorLike),
    ...propertyKeys(from.constructor as CtorLike),
  ]);
  const src = from as unknown as Record<PropertyKey, unknown>;
  const dst = to as unknown as Record<PropertyKey, unknown>;
  for (const key of keys) {
    if (skip.has(key)) {
      continue;
    }
    try {
      dst[key] = src[key];
    } catch {
      // A throwing setter; leave the default.
    }
  }
  for (const sym of privateKeys(from)) {
    try {
      Object.defineProperty(
        to,
        sym,
        Object.getOwnPropertyDescriptor(from, sym)!
      );
    } catch {
      // Non-configurable on the target; leave it.
    }
  }
};

const inside = (el: Node, node: unknown): boolean =>
  node !== null &&
  typeof node === 'object' &&
  typeof (node as Node).nodeType === 'number' &&
  el.contains(node as Node);

/**
 * Whether `el` (and its light DOM) carries no bindings, so another element
 * can take its place without lit-html noticing: no part targets it or an
 * element inside it, no child part's markers or parent lie inside it, and
 * nothing rendered into it as a container. `false` when `parts` is unknown.
 */
export const isReuseSafe = (
  el: ElementLike,
  parts: readonly PartLike[] | undefined
): boolean => {
  if (parts === undefined) {
    return false;
  }
  try {
    if (LIT_PART in el) {
      return false;
    }
    for (const part of parts) {
      if (inside(el, part.element)) {
        return false;
      }
      if (part.type === CHILD_PART) {
        const start = internal(part, START) as Node | null | undefined;
        const end = internal(part, END) as Node | null | undefined;
        if (
          inside(el, start) ||
          inside(el, end) ||
          inside(el, start?.parentNode) ||
          inside(el, end?.parentNode)
        ) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Puts `old` back where `fresh` is: `old` takes `fresh`'s attributes and
 * light-DOM children, then replaces it. `old` keeps its identity, state,
 * shadow DOM and controllers, and reconnects.
 */
export const swapBack = (old: ElementLike, fresh: ElementLike): void => {
  for (const attr of Array.from(old.attributes)) {
    if (!fresh.hasAttribute(attr.name)) {
      old.removeAttribute(attr.name);
    }
  }
  for (const attr of Array.from(fresh.attributes)) {
    if (old.getAttribute(attr.name) !== attr.value) {
      old.setAttribute(attr.name, attr.value);
    }
  }
  old.replaceChildren(...Array.from(fresh.childNodes));
  fresh.replaceWith(old);
};

interface Pending {
  root: Node;
  tag: string;
}

interface TransferWindow {
  mode: 'transfer' | 'reuse';
  /** Elements dropped during the window, by root then tag, in drop order. */
  pending: Map<Node, Map<string, ElementLike[]>>;
  pendingOf: Map<ElementLike, Pending>;
  /** (old, new) in pairing order; `old` is the chain's original element. */
  pairs: Array<[ElementLike, ElementLike]>;
  /** New element → the element it replaced (immediate predecessor). */
  pairOf: Map<ElementLike, ElementLike>;
  /** New element → the first element of its replacement chain. */
  originOf: Map<ElementLike, ElementLike>;
  /** Outstanding `watch()` batches. */
  waiting: number;
  idle?: ReturnType<typeof setTimeout>;
  cap?: ReturnType<typeof setTimeout>;
}

export interface ChildStateOptions {
  /** Read at every `open()`. */
  mode: () => ChildStateMode;
  /** Hard cap on a window's lifetime. Defaults to {@link WINDOW_CAP_MS}. */
  capMs?: number;
}

export interface ChildState {
  /**
   * From the instrumented `connectedCallback`, before the original runs.
   * `fresh` is whether the element has never been connected before.
   */
  connected(el: ElementLike, fresh: boolean): void;
  /** From the instrumented `disconnectedCallback`. */
  disconnected(el: ElementLike): void;
  /** A hot patch is about to re-render instances: open (or extend) a window. */
  open(): void;
  /** Keep the window open until these instances' updates complete. */
  watch(els: Iterable<ElementLike>): void;
  /** Whether a window is currently open. */
  readonly active: boolean;
}

export const createChildState = (options: ChildStateOptions): ChildState => {
  const capMs = options.capMs ?? WINDOW_CAP_MS;
  /** The root each element was last connected in. */
  const rootOf = new WeakMap<ElementLike, Node>();
  let current: TransferWindow | undefined;

  const close = (w: TransferWindow): void => {
    if (current !== w) {
      return;
    }
    current = undefined;
    clearTimeout(w.idle);
    clearTimeout(w.cap);
    // Reuse only once everything we waited on has settled; on the hard cap
    // with updates still outstanding, the transferred state stands.
    if (w.mode !== 'reuse' || w.waiting > 0) {
      return;
    }
    for (const [old, fresh] of w.pairs) {
      // A pair inside an element that was itself swapped back is moot:
      // the old element's shadow DOM came back intact with it.
      if (!fresh.isConnected || old.isConnected) {
        continue;
      }
      try {
        if (isReuseSafe(fresh, partsAround(fresh))) {
          swapBack(old, fresh);
        }
      } catch {
        // Leave the new element (it already has the transferred state).
      }
    }
  };

  /** Close once a macrotask passes with no tracked activity. */
  const settle = (w: TransferWindow): void => {
    if (current !== w || w.waiting > 0) {
      return;
    }
    clearTimeout(w.idle);
    w.idle = setTimeout(() => close(w), 0);
  };

  /** The pending-queue root for an element now connected in `root`. */
  const keyRoot = (w: TransferWindow, root: Node): Node => {
    const host = (root as Partial<ShadowRoot>).host as ElementLike | undefined;
    const old = host === undefined ? undefined : w.pairOf.get(host);
    if (old !== undefined) {
      // Re-created inside a new element's shadow: match against what was
      // dropped from the old element's shadow.
      const oldRoot = (old.renderRoot ?? old.shadowRoot) as Node | undefined;
      if (oldRoot !== undefined && oldRoot !== null && w.pending.has(oldRoot)) {
        return oldRoot;
      }
    }
    return root;
  };

  const unqueue = (w: TransferWindow, el: ElementLike): void => {
    const at = w.pendingOf.get(el);
    if (at === undefined) {
      return;
    }
    w.pendingOf.delete(el);
    const queue = w.pending.get(at.root)?.get(at.tag);
    const i = queue?.indexOf(el) ?? -1;
    if (i >= 0) {
      queue!.splice(i, 1);
    }
  };

  const pair = (w: TransferWindow, fresh: ElementLike, root: Node): void => {
    const queue = w.pending.get(keyRoot(w, root))?.get(fresh.localName);
    const old = queue?.shift();
    if (old === undefined) {
      return;
    }
    w.pendingOf.delete(old);
    w.pairOf.set(fresh, old);
    const origin = w.originOf.get(old) ?? old;
    w.originOf.set(fresh, origin);
    w.pairs.push([origin, fresh]);
    // lit-html assigns the new template instance to its part only after the
    // fragment is inserted, so the parts targeting `fresh` aren't reachable
    // yet. Queued before the original connectedCallback enables updating,
    // this runs ahead of `fresh`'s first update.
    queueMicrotask(() => {
      try {
        transferState(old, fresh, partsAround(fresh));
      } catch {
        // Keep the defaults.
      }
    });
  };

  return {
    connected(el, fresh) {
      let root: Node | undefined;
      try {
        root = el.getRootNode();
      } catch {
        root = undefined;
      }
      const w = current;
      if (w !== undefined) {
        try {
          if (fresh && root !== undefined && el.hasUpdated !== true) {
            pair(w, el, root);
          } else {
            // Moved, not re-created: it can't be anyone's replacement.
            unqueue(w, el);
          }
        } catch {
          // Pairing is best-effort.
        }
        settle(w);
      }
      if (root !== undefined) {
        rootOf.set(el, root);
      }
    },
    disconnected(el) {
      const w = current;
      if (w === undefined) {
        return;
      }
      const root = rootOf.get(el);
      if (root !== undefined) {
        const tag = el.localName;
        let byTag = w.pending.get(root);
        if (byTag === undefined) {
          w.pending.set(root, (byTag = new Map()));
        }
        let queue = byTag.get(tag);
        if (queue === undefined) {
          byTag.set(tag, (queue = []));
        }
        unqueue(w, el);
        queue.push(el);
        w.pendingOf.set(el, {root, tag});
      }
      settle(w);
    },
    open() {
      const mode = options.mode();
      if (mode !== 'transfer' && mode !== 'reuse') {
        return;
      }
      let w = current;
      if (w === undefined) {
        w = current = {
          mode,
          pending: new Map(),
          pendingOf: new Map(),
          pairs: [],
          pairOf: new Map(),
          originOf: new Map(),
          waiting: 0,
        };
      }
      w.mode = mode;
      clearTimeout(w.cap);
      const opened = w;
      w.cap = setTimeout(() => close(opened), capMs);
      settle(w);
    },
    watch(els) {
      const w = current;
      if (w === undefined) {
        return;
      }
      const promises: Promise<unknown>[] = [];
      for (const el of els) {
        try {
          const p = el.updateComplete;
          if (p instanceof Promise) {
            promises.push(p);
          }
        } catch {
          // No update promise to wait on.
        }
      }
      w.waiting++;
      clearTimeout(w.idle);
      let left = promises.length + 1;
      const done = () => {
        if (--left === 0) {
          w.waiting--;
          settle(w);
        }
      };
      for (const p of promises) {
        // Rethrow: a failed update must still surface as an unhandled
        // rejection, exactly as it would with nobody watching.
        void p.then(done, (e: unknown) => {
          done();
          throw e;
        });
      }
      queueMicrotask(done);
    },
    get active() {
      return current !== undefined;
    },
  };
};
