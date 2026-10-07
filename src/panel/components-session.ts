/**
 * What the Components tab knows about the page, and the rules that keep the
 * page in step with it: the tree, the selected element and its details, the
 * Live tree, the picker, and the HMR notices. Framework-free; the element in
 * `components-view.ts` renders it and re-renders on {@link subscribe}.
 *
 * The rules that matter live here rather than in the element's handlers:
 * which commands a selection sends and in what order, and what has to be
 * re-armed when the runtime reconnects or another page takes over, since the
 * page forgets its watch and its Live observer each time.
 */

import type {
  InspectorCommand,
  InspectorDetails,
  InspectorMessage,
  InspectorTreeNode,
} from '../types/inspector.js';
import type {
  HmrHistoryEntry,
  LitRuntimeInfo,
} from '../lib/devframe/protocol.js';
import {
  MAX_HMR_INCOMPATIBILITIES,
  type HmrIncompatibilityEvent,
} from '../types/hmr-incompatibility.js';
import type {HmrPatchEvent} from '../types/hmr-patch.js';

/** localStorage key holding whether Live is on. */
export const LIVE_LS_KEY = 'lit-devtools-components-live';

export interface ComponentsSessionPorts {
  /**
   * Send an inspector command to the page. Best-effort: the caller drops it
   * where there is no page to reach (a frozen snapshot, no connection yet).
   */
  send(command: InspectorCommand): void;
  /** Where Live is remembered across panel reloads. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** A different element was selected; fires before the state changes. */
  onSelect?(id: number): void;
  /** The page's picker chose an element; the tab should come forward. */
  onPicked?(): void;
}

/** What the panel has from the node side when it connects. */
export interface ComponentsPrime {
  roots: InspectorTreeNode[];
  hmrIncompatibilities: HmrIncompatibilityEvent[];
  /** Absent from a session dumped by an earlier version. */
  hmrHistory?: HmrHistoryEntry[];
}

/** The newest patch among `entries` (oldest first), skipping failures. */
export const lastPatchOf = (
  entries: readonly HmrHistoryEntry[]
): HmrPatchEvent | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.kind === 'patched') return entry.patch;
  }
  return null;
};

/**
 * Returns the ids of every ancestor of `id` (nearest last), or `null` if `id`
 * isn't in the tree. The target id itself is not included.
 */
export const findAncestors = (
  nodes: readonly InspectorTreeNode[],
  id: number
): number[] | null => {
  const trail: number[] = [];
  const walk = (list: readonly InspectorTreeNode[]): boolean => {
    for (const node of list) {
      if (node.id === id) return true;
      trail.push(node.id);
      if (walk(node.children)) return true;
      trail.pop();
    }
    return false;
  };
  return walk(nodes) ? [...trail] : null;
};

export class ComponentsSession {
  readonly #ports: ComponentsSessionPorts;
  readonly #listeners = new Set<() => void>();

  #roots: InspectorTreeNode[] = [];
  #selectedId: number | null = null;
  #details: InspectorDetails | null = null;
  #gone = false;
  #expanded: ReadonlySet<number> = new Set();
  #picking = false;
  #live: boolean;
  #runtime: LitRuntimeInfo | null = null;
  #hmrIncompatibilities: HmrIncompatibilityEvent[] = [];
  #lastPatch: HmrPatchEvent | null = null;

  constructor(ports: ComponentsSessionPorts) {
    this.#ports = ports;
    let stored: string | null = null;
    try {
      stored = ports.storage?.getItem(LIVE_LS_KEY) ?? null;
    } catch {
      // Storage unavailable: Live starts on.
    }
    this.#live = stored !== 'false';
  }

  get roots(): readonly InspectorTreeNode[] {
    return this.#roots;
  }
  get selectedId(): number | null {
    return this.#selectedId;
  }
  get details(): InspectorDetails | null {
    return this.#details;
  }
  /** The selected element is no longer in the page (removed or GC'd). */
  get gone(): boolean {
    return this.#gone;
  }
  get expanded(): ReadonlySet<number> {
    return this.#expanded;
  }
  get picking(): boolean {
    return this.#picking;
  }
  /** The opt-in live tree (a MutationObserver in the page). Remembered. */
  get live(): boolean {
    return this.#live;
  }
  /**
   * What the page runtime announced, from `get-meta` on connect and from each
   * `ready`. `null` until known. Only used to explain an empty tree.
   */
  get runtime(): LitRuntimeInfo | null {
    return this.#runtime;
  }
  /** Most recent last, capped like the node side's cache. */
  get hmrIncompatibilities(): readonly HmrIncompatibilityEvent[] {
    return this.#hmrIncompatibilities;
  }
  /** The most recent patch that landed. Not an issue: never badged. */
  get lastPatch(): HmrPatchEvent | null {
    return this.#lastPatch;
  }

  /** Call `listener` after every change. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The panel connected: take what the node side has cached, so a panel
   * opened after the page loaded isn't blank, then ask the page for a fresh
   * tree. Re-arms Live too, since the page released its observer when the
   * previous panel went away.
   */
  connected(prime: ComponentsPrime): void {
    this.#roots = prime.roots;
    this.#hmrIncompatibilities = prime.hmrIncompatibilities.slice(
      -MAX_HMR_INCOMPATIBILITIES
    );
    if (prime.hmrHistory) this.#lastPatch = lastPatchOf(prime.hmrHistory);
    this.#send({type: 'tree'});
    if (this.#live) this.#send({type: 'observe', enabled: true});
    this.#changed();
  }

  /** The runtime info `get-meta` reported on connect. */
  setRuntime(runtime: LitRuntimeInfo): void {
    this.#runtime = runtime;
    this.#changed();
  }

  /** A message from the page runtime, via the node side. */
  receive(message: InspectorMessage): void {
    switch (message.type) {
      case 'ready':
        this.#runtime = {
          ready: true,
          litPackages: message.litPackages ?? {},
          topFrame: message.topFrame ?? true,
          chromeTracks: message.chromeTracks ?? true,
        };
        // The runtime (re)connected with no memory of this panel: refresh
        // the tree and re-arm the selection's watch. It may also have dropped
        // Live (it releases the observer when the panel disconnects, and a
        // reload restarts it with none); `live` is what the user asked for.
        this.#send({type: 'tree'});
        if (this.#selectedId !== null) {
          this.#send({type: 'watch', id: this.#selectedId});
        }
        if (this.#live) this.#send({type: 'observe', enabled: true});
        break;
      case 'tree':
        this.#roots = message.roots;
        // Re-reveal the selection against the fresh tree: a just-picked node
        // may not have existed in the previous tree, so the reveal on select
        // found no ancestors to expand and the node stayed hidden.
        if (this.#selectedId !== null) this.#reveal(this.#selectedId);
        break;
      case 'details':
        if (message.details.id !== this.#selectedId) return;
        this.#details = message.details;
        this.#gone = false;
        break;
      case 'gone':
        if (message.id !== this.#selectedId) return;
        this.#details = null;
        this.#gone = true;
        break;
      case 'pick':
        this.#picking = false;
        this.#select(message.id);
        this.#ports.onPicked?.();
        break;
      default:
        return;
    }
    this.#changed();
  }

  /** A component couldn't be hot-patched in place. */
  hmrIncompatible(event: HmrIncompatibilityEvent): void {
    this.#hmrIncompatibilities = [...this.#hmrIncompatibilities, event].slice(
      -MAX_HMR_INCOMPATIBILITIES
    );
    this.#changed();
  }

  hmrPatched(event: HmrPatchEvent): void {
    this.#lastPatch = event;
    this.#changed();
  }

  /**
   * Another page took over. Drops the tree and HMR history the old page
   * reported, as the node side does, and asks the new page for its tree. The
   * selection stays: a reloaded tab mints the same ids in the same order, and
   * on another tab the details request answers for whatever holds the id
   * now. Its details do not: they describe the old document, so they are
   * cleared until the new page answers, and the watch went with the old
   * document, so the new page is told to watch the id or the pane never
   * hears of its updates.
   */
  pageChanged(): void {
    this.#roots = [];
    this.#lastPatch = null;
    this.#hmrIncompatibilities = [];
    const id = this.#selectedId;
    if (id !== null) {
      this.#details = null;
      this.#gone = false;
    }
    this.#refresh();
    if (id !== null) this.#send({type: 'watch', id});
    this.#changed();
  }

  /** Select an element: from the tree, a pick, or a link elsewhere. */
  select(id: number): void {
    if (this.#select(id)) this.#changed();
  }

  toggleExpand(id: number): void {
    const next = new Set(this.#expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.#expanded = next;
    this.#changed();
  }

  /** Ask the page again for the tree and the selection's details. */
  refresh(): void {
    this.#refresh();
  }

  togglePick(): void {
    this.#picking = !this.#picking;
    this.#send({type: 'pick'});
    this.#changed();
  }

  toggleLive(): void {
    this.#live = !this.#live;
    try {
      this.#ports.storage?.setItem(LIVE_LS_KEY, String(this.#live));
    } catch {
      // Storage unavailable: Live just won't be remembered.
    }
    // Resuming pushes a fresh tree on its own; pausing pulls one, so the
    // frozen tree is the page as of now.
    this.#send({type: 'observe', enabled: this.#live});
    if (!this.#live) this.#send({type: 'tree'});
    this.#changed();
  }

  /** The panel is going away: release what the page holds for it. */
  dispose(): void {
    this.#send({type: 'watch', id: null});
    if (this.#live) this.#send({type: 'observe', enabled: false});
  }

  #select(id: number): boolean {
    if (this.#selectedId === id) return false;
    this.#ports.onSelect?.(id);
    if (this.#selectedId !== null) this.#send({type: 'watch', id: null});
    this.#selectedId = id;
    this.#details = null;
    this.#gone = false;
    this.#reveal(id);
    // The tree too, in case the picked node is new.
    this.#send({type: 'tree'});
    this.#send({type: 'details', id});
    this.#send({type: 'watch', id});
    return true;
  }

  /** Expand every ancestor of `id` so the selected node is visible. */
  #reveal(id: number): void {
    const path = findAncestors(this.#roots, id);
    if (path === null) return;
    this.#expanded = new Set([...this.#expanded, ...path]);
  }

  #refresh(): void {
    this.#send({type: 'tree'});
    if (this.#selectedId !== null) {
      this.#send({type: 'details', id: this.#selectedId});
    }
  }

  #send(command: InspectorCommand): void {
    this.#ports.send(command);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
