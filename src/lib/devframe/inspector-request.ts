/**
 * Turns the fire-and-forget inspector channel into request/response for the
 * node side. The page answers a `tree` command with a `tree` message and a
 * `details` command with `details` or `gone`, but nothing correlates them, so
 * this resolves every waiter for that kind on the next matching message.
 * Bounded by a timeout: the null source never answers, and a page may be gone.
 */

import type {
  InspectorDetails,
  InspectorMessage,
  InspectorTreeNode,
} from '../../types/inspector.js';
import type {TimelineSource} from './source.js';

export interface InspectorRequester {
  /** Ask the page for its tree; `undefined` when nothing answered in time. */
  tree(timeoutMs: number): Promise<InspectorTreeNode[] | undefined>;
  /**
   * Ask the page for one element's details. `null` when the page reports it
   * gone; `undefined` when nothing answered in time.
   */
  details(
    id: number,
    timeoutMs: number
  ): Promise<InspectorDetails | null | undefined>;
  /** Feed every inbound page message through here before the cache sees it. */
  resolve(message: InspectorMessage): void;
}

export const createInspectorRequester = (
  source: Pick<TimelineSource, 'sendInspector'>
): InspectorRequester => {
  type Waiter<T> = (value: T) => void;
  let treeWaiters: Array<Waiter<InspectorTreeNode[]>> = [];
  const detailWaiters = new Map<
    number,
    Array<Waiter<InspectorDetails | null>>
  >();

  // Registers a waiter, sends the command, and settles on the first of the
  // reply or the timeout. The `finally` runs on every exit, including a
  // `sendInspector` that throws, so neither a waiter nor a timer outlives the
  // call.
  const request = async <T>(
    add: (waiter: Waiter<T>) => () => void,
    send: () => void,
    timeoutMs: number
  ): Promise<T | undefined> => {
    let remove: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<T | undefined>((resolve) => {
        remove = add(resolve);
        timer = setTimeout(() => resolve(undefined), timeoutMs);
        send();
      });
    } finally {
      clearTimeout(timer);
      remove();
    }
  };

  return {
    tree: (timeoutMs) =>
      request<InspectorTreeNode[]>(
        (waiter) => {
          treeWaiters.push(waiter);
          return () => {
            treeWaiters = treeWaiters.filter((w) => w !== waiter);
          };
        },
        () => source.sendInspector({type: 'tree'}),
        timeoutMs
      ),
    details: (id, timeoutMs) =>
      request<InspectorDetails | null>(
        (waiter) => {
          const list = detailWaiters.get(id) ?? [];
          list.push(waiter);
          detailWaiters.set(id, list);
          return () => {
            const rest = (detailWaiters.get(id) ?? []).filter(
              (w) => w !== waiter
            );
            if (rest.length === 0) detailWaiters.delete(id);
            else detailWaiters.set(id, rest);
          };
        },
        () => source.sendInspector({type: 'details', id}),
        timeoutMs
      ),
    resolve(message) {
      if (message.type === 'tree') {
        for (const waiter of treeWaiters) waiter(message.roots);
      } else if (message.type === 'details') {
        for (const waiter of detailWaiters.get(message.details.id) ?? []) {
          waiter(message.details);
        }
      } else if (message.type === 'gone') {
        for (const waiter of detailWaiters.get(message.id) ?? []) {
          waiter(null);
        }
      }
    },
  };
};
