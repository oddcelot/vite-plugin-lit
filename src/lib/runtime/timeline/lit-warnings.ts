/**
 * Lit dev-mode warnings, captured from the Set Lit records them in.
 *
 * Lit's development build reports mistakes through a module-private
 * `issueWarning(code, message)` that `console.warn`s once and adds the full
 * text (`<message> See https://lit.dev/msg/<code> for more information.`) to
 * `globalThis.litIssuedWarnings`, a Set shared by `@lit/reactive-element` and
 * `lit-html`. There is nothing to wrap, but the Set can be: this module makes
 * it if no Lit copy has yet and hooks its `add`, so every later warning
 * reaches {@link onLitWarning}, and entries recorded before the hook are
 * replayed. A production build never creates the Set, so nothing is captured.
 *
 * The Set also holds bare codes: an app adds one to silence that warning.
 * Those carry no message and are ignored.
 *
 * `warnings-boot.ts` runs this ahead of the app's own modules, so Lit finds
 * the hooked Set rather than making its own; the timeline runtime, injected
 * after the app, only finds what was recorded by then. The state lives on a
 * global so a second copy of this module shares it.
 */

export interface LitWarning {
  /** Lit's message code (`change-in-update`), or `''` when Lit gave none. */
  code: string;
  /** The message, without the trailing docs link. */
  message: string;
  /** The custom element tag the message names, when it names one. */
  tagName?: string;
  /** The component class the message names, when it names one. */
  className?: string;
  /** The element that was updating when it was issued, when that was the one. */
  elementId?: number;
}

type Listener = (warning: LitWarning) => void;

/** Who is updating right now; set by the lifecycle layer. */
export type UpdatingResolver = () => {
  tagName: string;
  elementId: number;
} | null;

interface State {
  warnings: LitWarning[];
  listeners: Set<Listener>;
  resolver: UpdatingResolver | null;
  /** Entries already turned into warnings, so a replay never repeats one. */
  seen: Set<string>;
  hooked: boolean;
}

const STATE = Symbol.for('@oddsquad/vite-plugin-lit#lit-warnings');

const stateOf = (): State => {
  const g = globalThis as {[STATE]?: State};
  return (g[STATE] ??= {
    warnings: [],
    listeners: new Set(),
    resolver: null,
    seen: new Set(),
    hooked: false,
  });
};

const DOCS_LINK =
  /\s*See https:\/\/lit\.dev\/msg\/([\w-]*) for more information\.$/;
const TAG_NAMED = /\b[Ee]lement ([a-z](?=[\w.-]*-)[\w.-]*\w)/;
const CLASS_NAMED = /^Field "[^"]*" on (\S+) was declared/;

/** Warnings the page always has; not a mistake worth a row. */
const IGNORED_CODES = new Set(['dev-mode']);

/**
 * Splits one Set entry into a {@link LitWarning}, or null for a bare code,
 * an entry that is not text, or a warning that is just dev-mode noise.
 */
export const parseLitWarning = (entry: unknown): LitWarning | null => {
  if (typeof entry !== 'string') return null;
  const link = DOCS_LINK.exec(entry);
  const message = (link === null ? entry : entry.slice(0, link.index)).trim();
  // A code has no sentence around it.
  if (message === '' || (link === null && /^[\w-]+$/.test(message))) {
    return null;
  }
  const code = link?.[1] ?? '';
  if (IGNORED_CODES.has(code)) return null;
  const tagName = TAG_NAMED.exec(message)?.[1];
  const className = CLASS_NAMED.exec(message)?.[1];
  return {
    code,
    message,
    ...(tagName === undefined ? {} : {tagName}),
    ...(className === undefined ? {} : {className}),
  };
};

const record = (entry: unknown): void => {
  const s = stateOf();
  const parsed = parseLitWarning(entry);
  if (parsed === null || s.seen.has(entry as string)) return;
  s.seen.add(entry as string);
  const updating = parsed.tagName === undefined ? null : safeUpdating(s);
  const warning: LitWarning =
    updating !== null && updating.tagName === parsed.tagName
      ? {...parsed, elementId: updating.elementId}
      : parsed;
  s.warnings.push(warning);
  for (const listener of s.listeners) {
    try {
      listener(warning);
    } catch {
      // dev tool — a consumer's bug must not break the app's warning
    }
  }
};

const safeUpdating = (s: State): ReturnType<UpdatingResolver> => {
  try {
    return s.resolver?.() ?? null;
  } catch {
    return null;
  }
};

/**
 * Hooks `litIssuedWarnings.add` (making the Set first if Lit has not) and
 * records what is already in it. Idempotent; never throws into the page.
 */
export const installLitWarningCapture = (): void => {
  const s = stateOf();
  if (s.hooked) return;
  try {
    const g = globalThis as {litIssuedWarnings?: Set<unknown>};
    const set = (g.litIssuedWarnings ??= new Set());
    const add = set.add.bind(set);
    set.add = (value: unknown) => {
      const result = add(value);
      record(value);
      return result;
    };
    s.hooked = true;
    for (const entry of set) record(entry);
  } catch {
    // A frozen global or a foreign Set: degrade to no warnings.
  }
};

/** Everything captured so far, oldest first. */
export const litWarnings = (): readonly LitWarning[] => stateOf().warnings;

/** Warnings that name `tagName` or the component class `className`. */
export const warningsFor = (
  tagName: string,
  className?: string
): LitWarning[] =>
  stateOf().warnings.filter(
    (w) =>
      w.tagName === tagName ||
      (className !== undefined && className !== '' && w.className === className)
  );

/** Calls `listener` for each warning captured from now on. Returns a detach. */
export const onLitWarning = (listener: Listener): (() => void) => {
  const {listeners} = stateOf();
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Tells the capture which element is mid-update, to attribute a warning. */
export const setUpdatingResolver = (
  resolver: UpdatingResolver | null
): void => {
  stateOf().resolver = resolver;
};
