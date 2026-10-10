/**
 * `@lit/task` controllers on a live element, read without importing the
 * library: the inspector shows them, the timeline's lifecycle layer reports
 * the ones that fail.
 */

import {clip, controllersOf, ctorName, hasFn, type Dict} from './live-reads.js';

const TASK_STATUS = ['initial', 'pending', 'complete', 'error'];
export const TASK_ERROR = TASK_STATUS.indexOf('error');

/** The `TaskStatus` name for a status number, or the number itself. */
export const taskStatusName = (status: number): string =>
  TASK_STATUS[status] ?? String(status);

/** `@lit/task` duck type: a controller with a numeric status, run() and render(). */
export const taskStatus = (v: Dict): number | undefined => {
  if (!hasFn(v, 'run') || !hasFn(v, 'render')) return undefined;
  try {
    const status = v['status'];
    return typeof status === 'number' ? status : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Every `@lit/task` controller the element holds, with the field it is stored
 * in (else its class name). Read-only and never throws, so the lifecycle layer
 * can call it on recorded updates.
 */
export const tasksOf = (el: Element): Array<{task: object; name: string}> => {
  const out: Array<{task: object; name: string}> = [];
  try {
    const controllers = controllersOf(el);
    if (controllers.length === 0) return out;
    const host = el as unknown as Dict;
    for (const c of controllers) {
      if (taskStatus(c as Dict) === undefined) continue;
      let name: string | undefined;
      for (const key of Object.keys(host)) {
        const desc = Object.getOwnPropertyDescriptor(host, key);
        if (desc !== undefined && 'value' in desc && desc.value === c) {
          name = clip(key);
          break;
        }
      }
      out.push({task: c, name: name ?? ctorName(c)});
    }
  } catch {
    // dev tool — an unreadable element reports no tasks
  }
  return out;
};

/**
 * Every `@lit/task` controller the element holds that is currently in its
 * error state, named as by {@link tasksOf}. Read-only and never throws, so the
 * lifecycle layer can call it after each update.
 */
export const erroredTasks = (
  el: Element
): Array<{task: object; name: string; error: unknown}> => {
  const out: Array<{task: object; name: string; error: unknown}> = [];
  for (const {task, name} of tasksOf(el)) {
    if (taskStatus(task as Dict) !== TASK_ERROR) continue;
    let error: unknown;
    try {
      error = (task as Dict)['error'];
    } catch {
      error = undefined;
    }
    out.push({task, name, error});
  }
  return out;
};
