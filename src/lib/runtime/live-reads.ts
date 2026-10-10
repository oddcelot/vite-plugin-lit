/**
 * Read-only, never-throwing reads of a live element's state, shared by the
 * inspector and the timeline. They run in the inspected page on objects from
 * libraries this package does not import, so everything is duck-typed, and a
 * getter on an object we do not recognise is never invoked.
 */

const MAX_NAME = 80;
/** Most controllers read off one element; keeps a controller-heavy class cheap. */
const MAX_CONTROLLERS = 24;

export type Dict = Record<string, unknown>;

export const isObject = (v: unknown): v is Dict =>
  typeof v === 'object' && v !== null;

export const clip = (s: string): string =>
  s.length > MAX_NAME ? s.slice(0, MAX_NAME) + '…' : s;

export const ctorName = (v: object): string => {
  try {
    const name = (v as {constructor?: {name?: unknown}}).constructor?.name;
    return typeof name === 'string' && name !== '' ? clip(name) : 'object';
  } catch {
    return 'object';
  }
};

/**
 * `obj[key]` only when it is a data property on `obj` or its prototype chain.
 * A getter on an object we do not recognise may compute or have side effects,
 * so it is treated as absent.
 */
export const dataProp = (
  obj: object,
  key: string
): {value: unknown} | undefined => {
  try {
    let o: object | null = obj;
    for (let i = 0; o !== null && o !== Object.prototype && i < 16; i++) {
      const desc = Object.getOwnPropertyDescriptor(o, key);
      if (desc !== undefined) {
        return 'value' in desc ? {value: desc.value} : undefined;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
  } catch {
    // A hostile proxy; treat as absent.
  }
  return undefined;
};

export const hasFn = (v: Dict, key: string): boolean => {
  try {
    return typeof v[key] === 'function';
  } catch {
    return false;
  }
};

/**
 * Lit keeps its controllers in a private `Set`: `__controllers` in the
 * development build, `_$EO` in the minified production build. There is no
 * public accessor, so a build that renames it again yields no controllers.
 */
export const controllersOf = (el: Element): object[] => {
  const host = el as unknown as Dict;
  const set =
    dataProp(host, '__controllers')?.value ?? dataProp(host, '_$EO')?.value;
  if (!(set instanceof Set)) return [];
  const out: object[] = [];
  for (const c of set) {
    if (isObject(c)) out.push(c);
    if (out.length >= MAX_CONTROLLERS) break;
  }
  return out;
};
