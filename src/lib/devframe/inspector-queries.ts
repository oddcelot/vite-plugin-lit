/**
 * The agent's component queries: the tree, and the details of one element or
 * of every element of a tag. Asked of the live page each time, since the
 * cache only holds what the panel last requested and an agent with no panel
 * open would otherwise read an empty tree.
 *
 * The rules a caller would otherwise have to know:
 * - The page gets a short timeout; silence falls back to the cache, so a
 *   query never hangs on a page that is gone or never answers.
 * - For one element, `null` is the page saying it is gone and wins over a
 *   cached entry; `undefined` from the page is silence.
 * - A frozen snapshot (or a build) has no page: the cache is the answer.
 *
 * Owns the {@link InspectorRequester} that correlates the page's replies with
 * these asks; every inbound inspector message goes through {@link resolve}.
 */

import type {
  InspectorDetails,
  InspectorMessage,
  InspectorTreeNode,
} from '../../types/inspector.js';
import {createInspectorRequester} from './inspector-request.js';
import type {
  ComponentDetailsArgs,
  ComponentDetailsByTagResult,
  ListComponentsArgs,
} from './protocol.js';
import type {TimelineSource} from './source.js';

export interface InspectorQueriesOptions {
  /** Where the asks go. */
  source: Pick<TimelineSource, 'sendInspector'>;
  /** What the page last reported, for when it does not answer. */
  cache: {
    roots(): InspectorTreeNode[];
    details(id: number): InspectorDetails | null;
  };
  /** A live page to ask; otherwise the cache is the answer. */
  live: boolean;
  /** How long to wait for the page before answering from the cache. */
  timeoutMs: number;
}

export interface InspectorQueries {
  /** The `list-components` query. */
  tree(args?: ListComponentsArgs): Promise<InspectorTreeNode[]>;
  /** The `component-details` query: one element by id, or a tag's elements. */
  details(
    args: ComponentDetailsArgs
  ): Promise<InspectorDetails | null | ComponentDetailsByTagResult>;
  /** Feed every inbound inspector message through here first. */
  resolve(message: InspectorMessage): void;
}

/** Copy of `nodes` cut off below `maxDepth` levels (1 = roots only). */
export const pruneTree = (
  nodes: readonly InspectorTreeNode[],
  maxDepth: number
): InspectorTreeNode[] =>
  nodes.map((node) => {
    if (maxDepth > 1) {
      return {...node, children: pruneTree(node.children, maxDepth - 1)};
    }
    const {children} = node;
    return children.length > 0
      ? {...node, children: [], hiddenChildren: children.length}
      : {...node, children: []};
  });

const DEFAULT_TAG_MATCHES = 20;
const MAX_TAG_MATCHES = 50;

/**
 * Ids of the elements with `tagName` (case-insensitive), in tree order:
 * parents before children, siblings as the page listed them. Capped at
 * `limit` (default 20, ceiling 50); `truncated` says more matched.
 */
export const findByTag = (
  roots: readonly InspectorTreeNode[],
  tagName: string,
  limit?: number
): {ids: number[]; truncated: boolean} => {
  const wanted = tagName.toLowerCase();
  const matches: number[] = [];
  const walk = (nodes: readonly InspectorTreeNode[]): void => {
    for (const node of nodes) {
      if (node.tagName.toLowerCase() === wanted) matches.push(node.id);
      walk(node.children);
    }
  };
  walk(roots);
  const cap =
    limit !== undefined && Number.isFinite(limit) && limit >= 1
      ? Math.min(Math.floor(limit), MAX_TAG_MATCHES)
      : DEFAULT_TAG_MATCHES;
  return {ids: matches.slice(0, cap), truncated: matches.length > cap};
};

export const createInspectorQueries = (
  options: InspectorQueriesOptions
): InspectorQueries => {
  const {cache, live, timeoutMs} = options;
  const requester = createInspectorRequester(options.source);

  const roots = async (): Promise<InspectorTreeNode[]> => {
    if (!live) return cache.roots();
    return (await requester.tree(timeoutMs)) ?? cache.roots();
  };

  const details = async (id: number): Promise<InspectorDetails | null> => {
    if (!live) return cache.details(id);
    const fresh = await requester.details(id, timeoutMs);
    return fresh === undefined ? cache.details(id) : fresh;
  };

  return {
    async tree(args = {}) {
      const all = await roots();
      const depth = args.maxDepth;
      return depth !== undefined && Number.isFinite(depth) && depth >= 1
        ? pruneTree(all, Math.floor(depth))
        : all;
    },
    async details(args) {
      if (!('tagName' in args)) return details(args.id);
      const {ids, truncated} = findByTag(
        await roots(),
        args.tagName,
        args.limit
      );
      // Concurrent: each live read waits up to the timeout on its own.
      const all = await Promise.all(ids.map(details));
      const found: InspectorDetails[] = [];
      const missing: number[] = [];
      all.forEach((d, i) => (d ? found.push(d) : missing.push(ids[i]!)));
      return {details: found, missing, truncated};
    },
    resolve: (message) => requester.resolve(message),
  };
};
