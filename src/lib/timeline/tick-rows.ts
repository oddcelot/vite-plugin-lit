/**
 * Folds the Timeline list's spans into update ticks, as pure functions.
 *
 * One component update is four spans (`performUpdate`, `willUpdate`,
 * `update`, `updated`) plus whatever else happened inside it. Read flat, that
 * is four rows per tick and the reader loses the thread; this module turns the
 * filtered span list into the rows the list shows — one `performUpdate` row
 * per tick, with the rest folded under it while the tick is expanded.
 *
 * What folds is decided by `groupId`: the lifecycle layer stamps every phase of
 * a tick with `${elementId}:${tick}`, and the lifecycle layer's point events
 * (`update skipped`, Lit warnings, late async errors) and the Custom events
 * layer's rows (when dispatched during the element's own update) carry the same
 * id. Folding is one level deep and never crosses ticks.
 *
 * Why a tick ran (`TimelineSpan.cause`) is not nested here: rows stay in time
 * order and `cause-rails.ts` draws the chain as rails. {@link causeParentKey}
 * only looks the cause's target up.
 *
 * Framework-free and memoisation-free on purpose: the list recomputes it when
 * its spans, filter or expanded set change, and the cost is linear.
 */

import type {TimelineSpan} from './derive.js';

/** The phase that brackets a tick and stands for it in the list. */
const ROOT_PHASE = 'performUpdate';

/** Layers whose rows fold under the tick their `groupId` names. */
const NESTING_LAYERS: readonly string[] = ['lit-lifecycle', 'custom-events'];

const SKIP_EVENT = 'update skipped';

/** What a collapsed tick row flags about the rows it hides. */
export type TickAttention = 'error' | 'warning' | 'skipped';

/** One row of the list: a span at a depth, with its fold's state if it has one. */
export interface ListRow {
  span: TimelineSpan;
  /** 0 for top-level rows, 1 for a row folded under a tick. */
  depth: number;
  /** Set on a tick row that has shown children. */
  tick?: {
    expanded: boolean;
    /** Children that pass the filters (what expanding would show). */
    count: number;
    /** The most severe thing among the shown children, or the tick itself. */
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

/** The `performUpdate` span of each tick among `spans`, by pairing id. */
const tickRoots = (
  spans: readonly TimelineSpan[]
): Map<string, TimelineSpan> => {
  const roots = new Map<string, TimelineSpan>();
  for (const span of spans) {
    if (isTickRoot(span)) roots.set(String(span.groupId), span);
  }
  return roots;
};

/**
 * Every folded span's key mapped to the key of its tick, computed once for all
 * of `spans`; what "expand all" opens.
 */
export const foldParentKeys = (
  spans: readonly TimelineSpan[]
): Map<string, string> => {
  const roots = tickRoots(spans);
  const keys = new Map<string, string>();
  for (const span of spans) {
    if (isTickRoot(span)) continue;
    const id = tickIdOf(span);
    const root = id === undefined ? undefined : roots.get(id);
    if (root !== undefined) keys.set(span.key, root.key);
  }
  return keys;
};

/** The key of the `performUpdate` row `span` folds under, if it folds. */
export const foldParentKey = (
  span: TimelineSpan,
  spans: readonly TimelineSpan[]
): string | undefined => {
  if (isTickRoot(span)) return undefined;
  const id = tickIdOf(span);
  if (id === undefined) return undefined;
  return spans.find((s) => isTickRoot(s) && String(s.groupId) === id)?.key;
};

/**
 * The key of the span that caused the tick `span`, if `span` is a tick with a
 * recorded cause whose target is among `spans`: the tick root the `update`
 * cause names, or the point span (no `groupId`) at the `event` cause's layer
 * and time.
 */
export const causeParentKey = (
  span: TimelineSpan,
  spans: readonly TimelineSpan[]
): string | undefined => {
  const {cause} = span;
  if (cause === undefined || !isTickRoot(span)) return undefined;
  if (cause.kind === 'update') {
    return spans.find(
      (s) => isTickRoot(s) && String(s.groupId) === cause.groupId
    )?.key;
  }
  // Input rows can share one coarsened `time` (mouseup and click), so a
  // cause that names the title picks that row; without one, the first.
  const atTime = spans.filter(
    (s) =>
      s.groupId === undefined &&
      s.layerId === cause.layerId &&
      s.start === cause.time
  );
  return (
    (cause.title === undefined
      ? undefined
      : atTime.find((s) => s.name === cause.title)) ?? atTime[0]
  )?.key;
};

/**
 * Builds the list's rows.
 *
 * `candidates` are the spans of the enabled layers, in start order; `matched`
 * is the subset the element, regex and range filters keep. Rules:
 *
 * - A tick that matches is shown with all of its candidate children. A tick
 *   that does not match is shown anyway when a child matches (so the match
 *   keeps its context), with just the matching children under it.
 * - A span whose tick is not among the candidates stays a top-level row, and a
 *   tick is always top level, whatever caused it.
 * - Children are listed only while their tick's key is in `expanded`.
 * - A tick with shown children carries `tick`; one without is a plain row.
 */
export const buildListRows = (
  candidates: readonly TimelineSpan[],
  matched: readonly TimelineSpan[],
  expanded: ReadonlySet<string>
): ListRow[] => {
  const match = new Set(matched);
  const roots = tickRoots(candidates);
  const children = new Map<TimelineSpan, TimelineSpan[]>();
  const tops: TimelineSpan[] = [];
  for (const span of candidates) {
    const id = isTickRoot(span) ? undefined : tickIdOf(span);
    const root = id === undefined ? undefined : roots.get(id);
    if (root === undefined) {
      tops.push(span);
      continue;
    }
    const list = children.get(root);
    if (list === undefined) children.set(root, [span]);
    else list.push(span);
  }

  const rows: ListRow[] = [];
  for (const span of tops) {
    const all = match.has(span);
    const kids = (children.get(span) ?? []).filter(
      (child) => all || match.has(child)
    );
    if (!all && kids.length === 0) continue;
    if (kids.length === 0) {
      rows.push({span, depth: 0});
      continue;
    }
    let attention = attentionOf(span);
    for (const kid of kids) attention = worse(attention, attentionOf(kid));
    const open = expanded.has(span.key);
    rows.push({
      span,
      depth: 0,
      tick: {
        expanded: open,
        count: kids.length,
        ...(attention === undefined ? {} : {attention}),
      },
    });
    if (open) for (const kid of kids) rows.push({span: kid, depth: 1});
  }
  return rows;
};
