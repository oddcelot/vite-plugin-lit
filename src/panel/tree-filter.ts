import type {InspectorTreeNode} from '../types/inspector.js';

/** Which tree nodes a filter keeps, and which of those matched it. */
export interface TreeFilterResult {
  /** Matching nodes plus every ancestor of one, so each match keeps its path. */
  keep: ReadonlySet<number>;
  /** Nodes whose tag or component name contains the query. */
  matched: ReadonlySet<number>;
}

/**
 * Filter the Components tree by tag or component class name, ignoring case.
 * An empty query keeps nothing; callers check for that and show the full
 * tree instead.
 */
export const filterTree = (
  roots: readonly InspectorTreeNode[],
  query: string
): TreeFilterResult => {
  const q = query.trim().toLowerCase();
  const keep = new Set<number>();
  const matched = new Set<number>();
  if (q === '') return {keep, matched};
  const visit = (node: InspectorTreeNode): boolean => {
    let kept = false;
    for (const child of node.children) kept = visit(child) || kept;
    if (
      node.tagName.toLowerCase().includes(q) ||
      (node.componentName?.toLowerCase().includes(q) ?? false)
    ) {
      matched.add(node.id);
      kept = true;
    }
    if (kept) keep.add(node.id);
    return kept;
  };
  for (const root of roots) visit(root);
  return {keep, matched};
};
