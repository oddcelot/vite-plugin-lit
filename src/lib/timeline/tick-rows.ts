/**
 * Groups the Timeline list's spans into update ticks, as pure functions.
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
 * id. Everything else stays a top-level row.
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

/** One row of the list: a span at a depth, with its tick's state if it is one. */
export interface ListRow {
  span: TimelineSpan;
  /** 0 for top-level rows, 1 for rows nested under a tick. */
  depth: 0 | 1;
  /** Set on a tick's `performUpdate` row that has something nested under it. */
  tick?: {
    expanded: boolean;
    /** Nested rows that pass the filters (what expanding would show). */
    count: number;
    /** The most severe thing among them, or the tick row itself. */
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

/** The key of the `performUpdate` row `span` nests under, if it nests. */
export const tickParentKey = (
  span: TimelineSpan,
  spans: readonly TimelineSpan[]
): string | undefined => {
  if (isTickRoot(span)) return undefined;
  const id = tickIdOf(span);
  if (id === undefined) return undefined;
  return spans.find((s) => isTickRoot(s) && String(s.groupId) === id)?.key;
};

/**
 * Builds the list's rows.
 *
 * `candidates` are the spans of the enabled layers, in start order; `matched`
 * is the subset the element, regex and range filters keep. Rules:
 *
 * - A tick is shown when its `performUpdate` matches, with all of its
 *   candidate children, or when only some child matches, in which case the
 *   parent is shown anyway (so the child keeps its context) with just the
 *   matching children.
 * - A nested span whose tick has no `performUpdate` among the candidates (the
 *   buffer cap evicted it, or the layer was off) stays a top-level row.
 * - Children are listed only while the tick's key is in `expanded`.
 */
export const buildListRows = (
  candidates: readonly TimelineSpan[],
  matched: readonly TimelineSpan[],
  expanded: ReadonlySet<string>
): ListRow[] => {
  const match = new Set(matched);
  const roots = new Map<string, TimelineSpan>();
  for (const span of candidates) {
    if (isTickRoot(span)) roots.set(String(span.groupId), span);
  }
  const children = new Map<string, TimelineSpan[]>();
  const nested = new Set<TimelineSpan>();
  for (const span of candidates) {
    if (isTickRoot(span)) continue;
    const id = tickIdOf(span);
    if (id === undefined || !roots.has(id)) continue;
    nested.add(span);
    const list = children.get(id);
    if (list === undefined) children.set(id, [span]);
    else list.push(span);
  }

  const rows: ListRow[] = [];
  for (const span of candidates) {
    if (nested.has(span)) continue;
    if (!isTickRoot(span)) {
      if (match.has(span)) rows.push({span, depth: 0});
      continue;
    }
    const all = children.get(String(span.groupId)) ?? [];
    const shown = match.has(span) ? all : all.filter((c) => match.has(c));
    if (!match.has(span) && shown.length === 0) continue;
    if (shown.length === 0) {
      rows.push({span, depth: 0});
      continue;
    }
    const open = expanded.has(span.key);
    const worst = [span, ...shown]
      .map(attentionOf)
      .reduce<TickAttention | undefined>(
        (a, b) =>
          a === undefined ||
          (b !== undefined && SEVERITY.indexOf(b) < SEVERITY.indexOf(a))
            ? b
            : a,
        undefined
      );
    rows.push({
      span,
      depth: 0,
      tick: {
        expanded: open,
        count: shown.length,
        ...(worst === undefined ? {} : {attention: worst}),
      },
    });
    if (open) for (const child of shown) rows.push({span: child, depth: 1});
  }
  return rows;
};
