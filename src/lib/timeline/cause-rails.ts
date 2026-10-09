/**
 * Lays the Timeline list's cause chains out as rails, the way `git log
 * --graph` draws branches: rows stay in time order and a vertical line in a
 * lane column connects each update to the row that caused it, across
 * whatever happened in between.
 *
 * The graph's nodes are the list's top-level rows that take part in a chain:
 * an update tick (`performUpdate`) or a `@lit/task` run (`task`) with a
 * recorded cause whose parent row is on screen, or any row that is such a
 * parent (a tick, a task run, or a mouse, keyboard or custom-event row). So a
 * click reads click → tick → task run → tick: the run hangs from the update
 * that started it, and the update its settling asked for hangs from the run.
 * A row in no chain draws nothing, so timers and other lone updates stay
 * quiet. Phases folded under a tick draw only the lines passing through them.
 *
 * Lanes are allocated in one pass over the rows. A node holds its lane while
 * it still has children to come. Its last child continues in the same lane;
 * earlier children fork into a free lane, and a leaf's lane is free again
 * after its row. Fan-out therefore costs lanes only while the forked children
 * themselves have children pending, and a chain is one colour from root to
 * leaf. Past {@link MAX_LANES} a child draws in its parent's lane instead of
 * forking, which keeps the column bounded at the price of a straight line
 * where a fork belongs.
 *
 * Pure and linear in the rows; the list recomputes it with its rows.
 */

import type {TimelineSpan} from './derive.js';
import {isTaskRun, type ListRow} from './tick-rows.js';

/** Lanes the column stops growing at. */
export const MAX_LANES = 8;

/** What one row draws in the lane column. */
export interface RailRow {
  /** The lane of this row's node, when it is one. */
  lane?: number;
  /**
   * The parent's lane this node forks from, when it did not continue the
   * parent's lane. A connector runs from that lane's top to the node.
   */
  fork?: number;
  /** Lanes with a straight line through this row, the node's own excluded. */
  through: number[];
  /** The node continues its parent's lane: a line enters from above. */
  above: boolean;
  /** The node has children to come: its lane continues below. */
  below: boolean;
  /** The chain this node belongs to, numbered by root, for its colour. */
  chain?: number;
}

const ROOT_PHASE = 'performUpdate';

const isTickRoot = (span: TimelineSpan): boolean =>
  span.layerId === 'lit-lifecycle' &&
  span.name === ROOT_PHASE &&
  span.groupId !== undefined;

/** A row that is caused, and can cause, through its groupId. */
const isGrouped = (span: TimelineSpan): boolean =>
  isTickRoot(span) || isTaskRun(span);

/**
 * Each top-level row's cause parent among the top-level rows: the tick or task
 * run whose groupId the cause names, or the point span with the cause's layer
 * and time.
 * A parent that is not on screen, or not earlier, leaves the row a root.
 */
export const causeParents = (
  rows: readonly ListRow[]
): Map<TimelineSpan, TimelineSpan> => {
  const roots = new Map<string, TimelineSpan>();
  // Point spans by layer and time, and by layer, time and name: input rows
  // can share one coarsened `time`, so a cause that carries the title wins.
  const points = new Map<string, TimelineSpan>();
  const order = new Map<TimelineSpan, number>();
  rows.forEach((row, index) => {
    if (row.depth !== 0) return;
    const {span} = row;
    order.set(span, index);
    if (isGrouped(span)) roots.set(String(span.groupId), span);
    else if (span.groupId === undefined) {
      const loose = `${span.layerId}\0${span.start}`;
      if (!points.has(loose)) points.set(loose, span);
      const exact = `${loose}\0${span.name}`;
      if (!points.has(exact)) points.set(exact, span);
    }
  });
  const parents = new Map<TimelineSpan, TimelineSpan>();
  for (const [span, index] of order) {
    const {cause} = span;
    if (cause === undefined || !isGrouped(span)) continue;
    const parent =
      cause.kind === 'event'
        ? ((cause.title === undefined
            ? undefined
            : points.get(`${cause.layerId}\0${cause.time}\0${cause.title}`)) ??
          points.get(`${cause.layerId}\0${cause.time}`))
        : roots.get(cause.groupId);
    if (parent === undefined || parent === span) continue;
    // Effects follow causes; a parent placed later is a stale cause.
    if ((order.get(parent) ?? Infinity) >= index) continue;
    parents.set(span, parent);
  }
  return parents;
};

/** The rail column for `rows`, one entry per row, in the same order. */
export const buildRails = (rows: readonly ListRow[]): RailRow[] => {
  const parents = causeParents(rows);
  const pending = new Map<TimelineSpan, number>();
  for (const parent of parents.values()) {
    pending.set(parent, (pending.get(parent) ?? 0) + 1);
  }

  /** Who holds each lane while it has children to come; null when free. */
  const owners: (TimelineSpan | null)[] = [];
  const laneOf = new Map<TimelineSpan, number>();
  const chainOf = new Map<TimelineSpan, number>();
  let chains = 0;

  const free = (): number | undefined => {
    const idx = owners.indexOf(null);
    if (idx !== -1) return idx;
    if (owners.length < MAX_LANES) {
      owners.push(null);
      return owners.length - 1;
    }
    return undefined;
  };
  const held = (except?: number): number[] => {
    const lanes: number[] = [];
    owners.forEach((owner, lane) => {
      if (owner !== null && lane !== except) lanes.push(lane);
    });
    return lanes;
  };

  return rows.map((row): RailRow => {
    const {span} = row;
    const children = pending.get(span) ?? 0;
    const parent = row.depth === 0 ? parents.get(span) : undefined;
    if (row.depth !== 0 || (parent === undefined && children === 0)) {
      return {through: held(), above: false, below: false};
    }

    let lane: number | undefined;
    let fork: number | undefined;
    let above = false;
    if (parent !== undefined) {
      const parentLane = laneOf.get(parent)!;
      const left = (pending.get(parent) ?? 1) - 1;
      pending.set(parent, left);
      const takeover = left === 0 ? parentLane : free();
      if (takeover === undefined) {
        // Column full: draw in the parent's lane, as a continuation would.
        lane = parentLane;
        above = true;
      } else if (takeover === parentLane) {
        lane = parentLane;
        above = true;
        owners[lane] = null;
      } else {
        lane = takeover;
        fork = parentLane;
      }
      chainOf.set(span, chainOf.get(parent)!);
    } else {
      lane = free();
      chainOf.set(span, chains++);
      if (lane === undefined) {
        // Column full and nothing to hang from: draw as a lone row.
        return {through: held(), above: false, below: false};
      }
    }
    laneOf.set(span, lane);
    const below = children > 0;
    const through = held(lane);
    if (below) owners[lane] = span;
    else if (owners[lane] === null || owners[lane] === span)
      owners[lane] = null;
    return {
      lane,
      ...(fork === undefined ? {} : {fork}),
      through,
      above,
      below,
      chain: chainOf.get(span)!,
    };
  });
};
