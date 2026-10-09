/**
 * Groups the Timeline list's spans into a tree of update ticks, as pure
 * functions.
 *
 * One component update is four spans (`performUpdate`, `willUpdate`,
 * `update`, `updated`) plus whatever else happened inside it. Read flat, that
 * is four rows per tick and the reader loses the thread; this module turns the
 * filtered span list into the rows the list shows — one `performUpdate` row
 * per tick, with the rest nested under it while the tick is expanded.
 *
 * What nests is decided by `groupId`: the lifecycle layer stamps every phase of
 * a tick with `${elementId}:${tick}`, and the lifecycle layer's point events
 * (`update skipped`, Lit warnings, late async errors) and the Custom events
 * layer's rows (when dispatched during the element's own update) carry the same
 * id.
 *
 * Ticks nest further by recorded cause (`TimelineSpan.cause`): a tick that was
 * scheduled while another element was updating hangs under that element's
 * `performUpdate`, and a tick scheduled by an event handler hangs under that
 * event's row (a mouse, keyboard or custom-event point span), which then
 * becomes an expandable row of its own. A tick whose parent is not among the
 * candidates (evicted, or its layer is off) stays a top-level row, as does
 * everything else.
 *
 * Framework-free and memoisation-free on purpose: the list recomputes it when
 * its spans, filter or expanded set change, and the cost is linear.
 */

import type {TimelineSpan} from './derive.js';

/** The phase that brackets a tick and stands for it in the list. */
const ROOT_PHASE = 'performUpdate';

/** Layers whose rows nest under the tick their `groupId` names. */
const NESTING_LAYERS: readonly string[] = ['lit-lifecycle', 'custom-events'];

const SKIP_EVENT = 'update skipped';

/** What a collapsed tick row flags about the rows it hides. */
export type TickAttention = 'error' | 'warning' | 'skipped';

/** One row of the list: a span at a depth, with its subtree's state if it has one. */
export interface ListRow {
  span: TimelineSpan;
  /** 0 for top-level rows, one more per level of nesting. */
  depth: number;
  /** Set on any row that has shown children: a tick or an event that caused one. */
  tick?: {
    expanded: boolean;
    /** Direct children that pass the filters (what expanding would show). */
    count: number;
    /** The most severe thing among all shown descendants, or the row itself. */
    attention?: TickAttention;
  };
}

/** The tick a span belongs to, as the pairing id, or undefined. */
const tickIdOf = (span: TimelineSpan): string | undefined => {
  if (!NESTING_LAYERS.includes(span.layerId)) return undefined;
  // Point spans drop `groupId` (their duration cell would read "…"), but the
  // event they came from keeps it.
  const id = span.groupId ?? span.events[0]?.groupId;
  return id === undefined ? undefined : String(id);
};

const isTickRoot = (span: TimelineSpan): boolean =>
  span.layerId === 'lit-lifecycle' &&
  span.name === ROOT_PHASE &&
  span.groupId !== undefined;

const attentionOf = (span: TimelineSpan): TickAttention | undefined => {
  if (span.error !== undefined || span.logType === 'error') return 'error';
  if (span.logType === 'warning') return 'warning';
  if (span.name === SKIP_EVENT) return 'skipped';
  return undefined;
};

const SEVERITY: readonly TickAttention[] = ['error', 'warning', 'skipped'];

const worse = (
  a: TickAttention | undefined,
  b: TickAttention | undefined
): TickAttention | undefined =>
  a === undefined ||
  (b !== undefined && SEVERITY.indexOf(b) < SEVERITY.indexOf(a))
    ? b
    : a;

/**
 * Each nested span's parent among `spans`, by the rules in the header: same
 * tick, then `update` cause, then `event` cause. A cause loop is cut where it
 * closes, so every span stays reachable from a top-level row.
 */
const parentsOf = (
  spans: readonly TimelineSpan[]
): Map<TimelineSpan, TimelineSpan> => {
  const roots = new Map<string, TimelineSpan>();
  const points = new Map<string, TimelineSpan>();
  for (const span of spans) {
    if (isTickRoot(span)) roots.set(String(span.groupId), span);
    else if (span.groupId === undefined) {
      const id = `${span.layerId}\0${span.start}`;
      if (!points.has(id)) points.set(id, span);
    }
  }

  const parents = new Map<TimelineSpan, TimelineSpan>();
  for (const span of spans) {
    let parent: TimelineSpan | undefined;
    if (!isTickRoot(span)) {
      const id = tickIdOf(span);
      parent = id === undefined ? undefined : roots.get(id);
    } else if (span.cause?.kind === 'update') {
      parent = roots.get(span.cause.groupId);
    } else if (span.cause?.kind === 'event') {
      parent = points.get(`${span.cause.layerId}\0${span.cause.time}`);
    }
    if (parent !== undefined) parents.set(span, parent);
  }

  for (const span of spans) {
    const seen = new Set([span]);
    let current = span;
    for (let up = parents.get(current); up !== undefined;) {
      if (seen.has(up)) {
        parents.delete(current);
        break;
      }
      seen.add(up);
      current = up;
      up = parents.get(current);
    }
  }
  return parents;
};

/** The keys of the spans `span` nests under, nearest parent first; empty at top level. */
export const tickAncestorKeys = (
  span: TimelineSpan,
  spans: readonly TimelineSpan[]
): string[] => {
  const parents = parentsOf(spans);
  const keys: string[] = [];
  for (let up = parents.get(span); up !== undefined; up = parents.get(up)) {
    keys.push(up.key);
  }
  return keys;
};

/**
 * Every nested span's key mapped to its direct parent's key, computed once
 * for all of `spans`; what "expand all" opens.
 */
export const tickParentKeys = (
  spans: readonly TimelineSpan[]
): Map<string, string> => {
  const keys = new Map<string, string>();
  for (const [child, parent] of parentsOf(spans))
    keys.set(child.key, parent.key);
  return keys;
};

/** The key of the row `span` nests under directly, if it nests. */
export const tickParentKey = (
  span: TimelineSpan,
  spans: readonly TimelineSpan[]
): string | undefined => tickAncestorKeys(span, spans)[0];

interface Node {
  span: TimelineSpan;
  kids: Node[];
  attention?: TickAttention;
}

/**
 * Builds the list's rows.
 *
 * `candidates` are the spans of the enabled layers, in start order; `matched`
 * is the subset the element, regex and range filters keep. Rules:
 *
 * - A row that matches is shown with all of its candidate descendants. A row
 *   that does not match is shown anyway when a descendant matches (so the
 *   match keeps its context), with just the matching descendants and their
 *   ancestors under it.
 * - A span whose parent is not among the candidates stays a top-level row.
 * - Children are listed only while every ancestor's key is in `expanded`.
 * - Any row with shown children carries `tick`; one without is a plain row.
 */
export const buildListRows = (
  candidates: readonly TimelineSpan[],
  matched: readonly TimelineSpan[],
  expanded: ReadonlySet<string>
): ListRow[] => {
  const match = new Set(matched);
  const parents = parentsOf(candidates);
  const children = new Map<TimelineSpan, TimelineSpan[]>();
  const tops: TimelineSpan[] = [];
  for (const span of candidates) {
    const parent = parents.get(span);
    if (parent === undefined) {
      tops.push(span);
      continue;
    }
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [span]);
    else list.push(span);
  }

  const hasMatch = new Map<TimelineSpan, boolean>();
  const subtreeMatches = (span: TimelineSpan): boolean => {
    let hit = hasMatch.get(span);
    if (hit === undefined) {
      hit = match.has(span) || (children.get(span) ?? []).some(subtreeMatches);
      hasMatch.set(span, hit);
    }
    return hit;
  };

  /** `all`: an ancestor matched, so everything below it is shown. */
  const build = (span: TimelineSpan, all: boolean): Node => {
    const below = all || match.has(span);
    const kids = (children.get(span) ?? [])
      .filter((child) => below || subtreeMatches(child))
      .map((child) => build(child, below));
    let attention = attentionOf(span);
    for (const kid of kids) attention = worse(attention, kid.attention);
    return {span, kids, ...(attention === undefined ? {} : {attention})};
  };

  const rows: ListRow[] = [];
  const emit = (node: Node, depth: number): void => {
    if (node.kids.length === 0) {
      rows.push({span: node.span, depth});
      return;
    }
    const open = expanded.has(node.span.key);
    rows.push({
      span: node.span,
      depth,
      tick: {
        expanded: open,
        count: node.kids.length,
        ...(node.attention === undefined ? {} : {attention: node.attention}),
      },
    });
    if (open) for (const kid of node.kids) emit(kid, depth + 1);
  };

  for (const span of tops) {
    if (subtreeMatches(span)) emit(build(span, false), 0);
  }
  return rows;
};
