/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * In-place custom element class patching.
 *
 * Vite HMR re-executes an edited component module, which calls
 * `customElements.define()` again with a freshly evaluated class. The
 * platform registry can't re-define a tag, and live instances keep their
 * original prototype chain, so instead of swapping classes we intercept the
 * duplicate define and patch the originally-registered class in place:
 * copy prototype + static descriptors from the new class onto the old one
 * and nudge live instances to re-render.
 *
 * This module is dependency-free and duck-typed against ReactiveElement so
 * it never imports lit (keeps it version-agnostic and safe for non-Lit
 * custom elements, which get prototype/static patching only).
 */

import {subscribeOverride} from './overrides.js';

/** Minimal `import.meta.hot` shape used to receive live setting overrides. */
type HotChannel = {on: (event: string, cb: (data: unknown) => void) => void};

export interface PatchOptions {
  /**
   * Cycle `disconnectedCallback()`/`connectedCallback()` on live instances
   * after a hot patch. Defaults to `false`.
   */
  reconnect?: boolean;

  /**
   * What to do when a component can't be hot-patched in place (e.g.
   * standard `accessor` decorators). Defaults to `'reload'`.
   */
  onIncompatible?: 'reload' | 'warn';
}

interface ReactiveElementLike extends HTMLElement {
  requestUpdate?: () => void;
  renderRoot?: unknown;
  connectedCallback?: () => void;
  disconnectedCallback?: () => void;
}

/** Duck-typed view of ReactiveElement constructor statics. */
interface ReactiveCtorLike extends CustomElementConstructor {
  finalize?: () => void;
  elementProperties?: Map<PropertyKey, unknown>;
  elementStyles?: ReadonlyArray<unknown>;
  observedAttributes?: readonly string[];
  _initializers?: Array<(element: unknown) => void>;
}

interface TagRecord {
  tagName: string;
  canonical: CustomElementConstructor;
  instances: Set<ReactiveElementLike>;
  generation: number;
}

interface PatchState {
  records: Map<string, TagRecord>;
  /** Generation a (possibly detached) instance last caught up to. */
  generationOf: WeakMap<ReactiveElementLike, number>;
  options: Required<PatchOptions>;
}

type LifecycleName = 'connectedCallback' | 'disconnectedCallback';

interface BrandedWrapper {
  (this: ReactiveElementLike): void;
  [RECORD_BRAND]?: TagRecord;
}

// Exactly one patch state per page, even if this module loads twice.
const STATE_KEY = Symbol.for('@lit-labs/vite-plugin-lit#patch');
// Brands our lifecycle wrappers so re-instrumentation is idempotent.
const RECORD_BRAND = Symbol.for('@lit-labs/vite-plugin-lit#wrapperRecord');

const PROTO_SKIP: ReadonlyArray<PropertyKey> = ['constructor'];
const STATIC_SKIP: ReadonlyArray<PropertyKey> = ['prototype', 'name', 'length'];

const ownKeys = (o: object): PropertyKey[] => [
  ...Object.getOwnPropertyNames(o),
  ...Object.getOwnPropertySymbols(o),
];

/**
 * Syncs own members `source` → `target`: deletes own keys of `target` that
 * vanished from `source`, then copies every own descriptor of `source`.
 * Individual copies are best-effort (non-configurable slots are skipped).
 */
// Exported for unit testing; otherwise module-internal.
export const syncOwnMembers = (
  target: object,
  source: object,
  skip: ReadonlyArray<PropertyKey>
) => {
  for (const key of ownKeys(target)) {
    if (skip.includes(key)) {
      continue;
    }
    if (Object.getOwnPropertyDescriptor(source, key) === undefined) {
      try {
        delete (target as Record<PropertyKey, unknown>)[key];
      } catch {
        // Non-configurable; leave it.
      }
    }
  }
  for (const key of ownKeys(source)) {
    if (skip.includes(key)) {
      continue;
    }
    try {
      Object.defineProperty(
        target,
        key,
        Object.getOwnPropertyDescriptor(source, key)!
      );
    } catch {
      // Non-configurable; leave it.
    }
  }
};

/**
 * Defines branded `connectedCallback`/`disconnectedCallback` wrappers on the
 * prototype to maintain the live-instance set and generation stamps. Called
 * at first define and again after every patch (descriptor sync replaces or
 * deletes the wrappers).
 */
const instrument = (
  state: PatchState,
  proto: object,
  record: TagRecord
): void => {
  for (const name of [
    'connectedCallback',
    'disconnectedCallback',
  ] as const satisfies readonly LifecycleName[]) {
    const own = Object.getOwnPropertyDescriptor(proto, name);
    if ((own?.value as BrandedWrapper | undefined)?.[RECORD_BRAND] === record) {
      continue;
    }
    // May be an own raw function (just copied from the new class), an
    // inherited base implementation, or absent entirely.
    const original = (proto as Record<LifecycleName, (() => void) | undefined>)[
      name
    ];
    const wrapper: BrandedWrapper =
      name === 'connectedCallback'
        ? function (this: ReactiveElementLike) {
            record.instances.add(this);
            const stamp = state.generationOf.get(this);
            if (stamp !== undefined && stamp !== record.generation) {
              // Was detached during one or more patches; catch up.
              this.requestUpdate?.();
            }
            state.generationOf.set(this, record.generation);
            original?.call(this);
          }
        : function (this: ReactiveElementLike) {
            record.instances.delete(this);
            original?.call(this);
          };
    wrapper[RECORD_BRAND] = record;
    try {
      Object.defineProperty(proto, name, {
        value: wrapper,
        writable: true,
        configurable: true,
      });
    } catch {
      // Non-configurable lifecycle slot; tracking degrades gracefully.
    }
  }
};

/**
 * Detects standard-decorator (`accessor`) reactive properties on the new
 * class. Those close over per-class-evaluation private slots, so copied
 * accessors would brand-check-throw — in-place patching is impossible.
 */
const usesStandardDecorators = (ctor: ReactiveCtorLike): boolean => {
  const metadataSymbol = (Symbol as {metadata?: symbol}).metadata;
  if (metadataSymbol === undefined) {
    return false;
  }
  const metadata = Object.getOwnPropertyDescriptor(ctor, metadataSymbol)
    ?.value as object | undefined;
  if (metadata === undefined || metadata === null) {
    return false;
  }
  // litPropertyMetadata is a Lit internal (not public API). Guard against
  // rename, removal, or shape changes — a false negative here means we try
  // to hot-patch and crash, which is handled by the outer catch in hotPatch.
  try {
    const litPropertyMetadata = (
      globalThis as {
        litPropertyMetadata?: WeakMap<object, Map<unknown, unknown>>;
      }
    ).litPropertyMetadata;
    const properties = litPropertyMetadata?.get(metadata);
    return properties !== undefined && properties.size > 0;
  } catch {
    return false;
  }
};

/**
 * Resolves a static `elementStyles` array to its constructed `CSSStyleSheet`s.
 * Returns `null` for a non-array or any shimmed sheet (no constructible
 * stylesheet support), so callers can bail rather than adopt a partial list.
 */
const stylesToSheets = (styles: unknown): CSSStyleSheet[] | null => {
  if (!Array.isArray(styles)) return null;
  const sheets: CSSStyleSheet[] = [];
  for (const style of styles) {
    const sheet =
      style instanceof CSSStyleSheet
        ? style
        : ((style as {styleSheet?: CSSStyleSheet} | null)?.styleSheet ??
          undefined);
    if (!(sheet instanceof CSSStyleSheet)) return null;
    sheets.push(sheet);
  }
  return sheets;
};

/**
 * Re-adopts constructed stylesheets on an instance's shadow root from the
 * (just-patched) static `elementStyles`. Local reimplementation — no lit
 * import. Skips cleanly for light-DOM components and shimmed sheets.
 *
 * `oldSheets` are the sheets the pre-patch class contributed (captured before
 * the static sync). We drop exactly those and append the new set, leaving any
 * sheet adopted imperatively by other code in place rather than clobbering the
 * whole list.
 */
const readoptStyles = (
  el: ReactiveElementLike,
  oldSheets: CSSStyleSheet[]
): void => {
  const root = el.renderRoot;
  if (typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) {
    return;
  }
  const sheets = stylesToSheets(
    (el.constructor as ReactiveCtorLike).elementStyles
  );
  if (sheets === null) {
    return;
  }
  const drop = new Set(oldSheets);
  const ours = new Set(sheets);
  // Our styles go first, matching Lit's own order (extra sheets appended).
  const preserved = [...root.adoptedStyleSheets].filter(
    (s) => !drop.has(s) && !ours.has(s)
  );
  root.adoptedStyleSheets = [...sheets, ...preserved];
};

const incompatible = (
  state: PatchState,
  tagName: string,
  reason: string
): void => {
  if (state.options.onIncompatible === 'warn') {
    console.warn(
      `[lit-plugin] <${tagName}> can't be hot-patched (${reason}). ` +
        `Reload the page to pick up the change.`
    );
  } else {
    console.info(
      `[lit-plugin] <${tagName}>: ${reason} — performing full reload.`
    );
    location.reload();
  }
};

/**
 * Patches the originally-registered class for `record.tagName` in place
 * from the freshly evaluated `NewClass`, then updates live instances.
 */
const hotPatch = (
  state: PatchState,
  record: TagRecord,
  NewClass: ReactiveCtorLike
): void => {
  const OldClass = record.canonical as ReactiveCtorLike;
  try {
    // 1. Materialize finalized/elementProperties/elementStyles/
    //    __attributeToPropertyMap on the new class before we copy statics.
    if (typeof NewClass.finalize === 'function') {
      NewClass.finalize();
    }

    // 2. Standard-decorator `accessor` properties can't be patched in place.
    if (usesStandardDecorators(NewClass)) {
      incompatible(state, record.tagName, 'standard accessor decorators');
      return;
    }

    // The platform snapshots observedAttributes at define time; new
    // attribute observations can't take effect without a reload.
    const oldObserved = [...(OldClass.observedAttributes ?? [])];
    const newObserved = [...(NewClass.observedAttributes ?? [])];

    // 3. Snapshot reactive property values per live instance through the
    //    OLD accessors. Vite serves prod lit in dev (no `development`
    //    export condition), where accessor storage keys are unique
    //    Symbol()s per class evaluation — without this, state resets.
    const propertyKeys = new Set<PropertyKey>([
      ...(OldClass.elementProperties?.keys() ?? []),
      ...(NewClass.elementProperties?.keys() ?? []),
    ]);
    const snapshots = new Map<ReactiveElementLike, Map<PropertyKey, unknown>>();
    for (const el of record.instances) {
      const values = new Map<PropertyKey, unknown>();
      for (const key of propertyKeys) {
        values.set(key, (el as unknown as Record<PropertyKey, unknown>)[key]);
      }
      snapshots.set(el, values);
    }

    // 4. Re-parent prototype chains. Mixins regenerate intermediate classes
    //    on every module evaluation, so the parents usually differ.
    const newProtoParent = Object.getPrototypeOf(NewClass.prototype) as object;
    if (Object.getPrototypeOf(OldClass.prototype) !== newProtoParent) {
      Object.setPrototypeOf(OldClass.prototype, newProtoParent);
    }
    const newStaticParent = Object.getPrototypeOf(NewClass) as object;
    if (Object.getPrototypeOf(OldClass) !== newStaticParent) {
      Object.setPrototypeOf(OldClass, newStaticParent);
    }

    // Capture the sheets the OLD class contributed before the static sync
    // overwrites `elementStyles`, so readoptStyles can drop exactly those and
    // leave imperatively-adopted sheets in place.
    const oldSheets = stylesToSheets(OldClass.elementStyles) ?? [];

    // 5. Sync own members new → old on the prototype and on statics.
    syncOwnMembers(OldClass.prototype, NewClass.prototype, PROTO_SKIP);
    syncOwnMembers(OldClass, NewClass, STATIC_SKIP);

    // 6. The sync replaced/removed our lifecycle wrappers; re-instrument.
    instrument(state, OldClass.prototype, record);
    record.generation++;
    // Module-local `instanceof NewClass` checks keep working against
    // instances of the canonical class.
    Object.defineProperty(NewClass, Symbol.hasInstance, {
      value: (instance: unknown) =>
        typeof instance === 'object' &&
        instance !== null &&
        OldClass.prototype.isPrototypeOf(instance),
      configurable: true,
    });

    if (
      oldObserved.length !== newObserved.length ||
      oldObserved.some((attr, i) => attr !== newObserved[i])
    ) {
      console.info(
        `[lit-plugin] <${record.tagName}> changed observedAttributes; the ` +
          `platform registry can't pick this up — reload recommended.`
      );
    }

    // 7. Update live instances.
    const newPropertyKeys = NewClass.elementProperties?.keys() ?? [];
    // After the static sync this is the NEW class's initializer list.
    const initializers = OldClass._initializers;
    for (const el of [...record.instances]) {
      if (state.options.reconnect) {
        el.disconnectedCallback?.();
        el.connectedCallback?.();
      }
      // Decorator-created reactive controllers (e.g. @lit/context's
      // @provide/@consume) live in per-class-evaluation closures keyed by
      // instance via addInitializer. Re-running the initializers enrolls
      // live instances in the new closures — without this, the first
      // assignment through a copied accessor throws and we'd full-reload.
      // Controllers from previous evaluations stay attached but inert
      // (everything flows through the newest closures); that's bounded by
      // edit count and dev-only. Runs before the value restore so e.g. a
      // re-created ContextProvider exists when the restore pushes into it.
      if (Array.isArray(initializers)) {
        for (const initialize of initializers) {
          initialize(el);
        }
      }
      const values = snapshots.get(el);
      if (values !== undefined) {
        // Restore through the new accessors — only keys the new class
        // still declares.
        for (const key of newPropertyKeys) {
          if (values.has(key)) {
            (el as unknown as Record<PropertyKey, unknown>)[key] =
              values.get(key);
          }
        }
      }
      readoptStyles(el, oldSheets);
      state.generationOf.set(el, record.generation);
      el.requestUpdate?.();
    }
  } catch (e) {
    incompatible(
      state,
      record.tagName,
      `patching failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
};

/**
 * Installs the `customElements.define` interceptor. Idempotent (per-page
 * global guard); no-ops in environments without `customElements` (SSR).
 */
export const install = (options: PatchOptions = {}): void => {
  if (typeof customElements === 'undefined') {
    return;
  }
  const g = globalThis as unknown as Record<symbol, PatchState | undefined>;
  const existing = g[STATE_KEY];
  if (existing !== undefined) {
    // Already installed; refresh explicitly-provided options only.
    if (options.reconnect !== undefined) {
      existing.options.reconnect = options.reconnect;
    }
    if (options.onIncompatible !== undefined) {
      existing.options.onIncompatible = options.onIncompatible;
    }
    return;
  }
  const state: PatchState = {
    records: new Map(),
    generationOf: new WeakMap(),
    options: {
      reconnect: options.reconnect ?? false,
      onIncompatible: options.onIncompatible ?? 'reload',
    },
  };
  g[STATE_KEY] = state;

  // Let the DevTools panel override these behaviours live (and persist across
  // reloads) on top of the config-time defaults above.
  subscribeOverride((import.meta as {hot?: HotChannel}).hot, (o) => {
    if (o.hmrReconnect !== undefined) state.options.reconnect = o.hmrReconnect;
    if (o.hmrOnIncompatible !== undefined) {
      state.options.onIncompatible = o.hmrOnIncompatible;
    }
  });

  const nativeDefine = customElements.define;
  customElements.define = function (
    this: CustomElementRegistry,
    name: string,
    ctor: CustomElementConstructor,
    defineOptions?: ElementDefinitionOptions
  ) {
    let record = state.records.get(name);
    if (record === undefined && this.get(name) !== undefined) {
      // Defined before install() ran (shouldn't happen — the installer is
      // import-hoisted — but recover gracefully without instance tracking).
      record = {
        tagName: name,
        canonical: this.get(name)!,
        instances: new Set(),
        generation: 0,
      };
      state.records.set(name, record);
    }
    if (record === undefined) {
      record = {
        tagName: name,
        canonical: ctor,
        instances: new Set(),
        generation: 0,
      };
      state.records.set(name, record);
      instrument(state, ctor.prototype, record);
      return nativeDefine.call(this, name, ctor, defineOptions);
    }
    if (ctor === record.canonical) {
      // Same class object re-defined; nothing to patch.
      return;
    }
    hotPatch(state, record, ctor as ReactiveCtorLike);
  };
};
