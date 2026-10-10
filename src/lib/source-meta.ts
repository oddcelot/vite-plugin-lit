import type MagicString from 'magic-string';

/** Stable key shared between transform output and runtime resolution. */
export const SOURCE_META_KEY = '@oddsquad/vite-plugin-lit#source';

/**
 * The expression string used in generated code to reference the shared
 * symbol at runtime.
 */
export const SOURCE_META_SYM = `Symbol.for('${SOURCE_META_KEY}')`;

export interface InjectedSourceMeta {
  filePath: string;
  lineNumber: number;
  componentName?: string;
}

/** 1-based line number for an index in source text. */
export const lineNumberAt = (code: string, index: number): number =>
  code.slice(0, index).split('\n').length;

/**
 * Index just past the string literal whose opening quote is at `i`, honouring
 * backslash escapes. An unterminated literal runs past the end of `code`.
 */
const skipQuoted = (code: string, i: number): number => {
  const quote = code[i];
  i++;
  while (i < code.length && code[i] !== quote) {
    if (code[i] === '\\') i++;
    i++;
  }
  return i + 1;
};

/**
 * Index just past the comment starting at `i`; `i` itself when none starts
 * there, `-1` when it never ends.
 */
const skipComment = (code: string, i: number): number => {
  if (code[i] !== '/') return i;
  const kind = code[i + 1];
  if (kind !== '/' && kind !== '*') return i;
  const end = code.indexOf(kind === '/' ? '\n' : '*/', i + 2);
  if (end === -1) return -1;
  // A line comment stops at the newline; the newline itself is plain code.
  return kind === '/' ? end : end + 2;
};

/**
 * True when a `/` at `i` can start a regex literal rather than divide: scan
 * back over whitespace to the last significant char — a regex can only follow
 * an operator, opening punctuation, or a keyword like `return`. `a / b` has an
 * identifier there, so it's division and scans on as plain code.
 */
const regexAllowedAt = (code: string, i: number): boolean => {
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  if (j < 0) return true;
  return (
    /[=:(,+\-!&|?{}[;]/.test(code[j]) ||
    /(?:^|[^\w$])(?:return|typeof|case|instanceof|in|of|new|delete|void|throw|do|else|yield|await)$/.test(
      code.slice(Math.max(0, j - 11), j + 1)
    )
  );
};

/**
 * Index of the `/` closing a regex whose body starts at `k`, or where the
 * scan gave up (end of line or input). A `/` inside a `[…]` char class doesn't
 * close it.
 */
const findRegexEnd = (code: string, k: number): number => {
  let inCharClass = false;
  while (
    k < code.length &&
    code[k] !== '\n' &&
    (inCharClass || code[k] !== '/')
  ) {
    if (code[k] === '\\') k++;
    else if (code[k] === '[') inCharClass = true;
    else if (code[k] === ']') inCharClass = false;
    k++;
  }
  return k;
};

/**
 * Index just past the regex literal starting at `i`; `i` itself when what
 * starts there is division, or a `/` with no closing `/` before the line ends
 * — not a regex after all.
 */
const skipRegex = (code: string, i: number): number => {
  if (code[i] !== '/' || !regexAllowedAt(code, i)) return i;
  const k = findRegexEnd(code, i + 1);
  return code[k] === '/' ? k + 1 : i;
};

/**
 * Brace depth of the code scope currently being scanned. Entering a `${…}`
 * interpolation pushes the enclosing scope's depth onto `enclosing` and
 * restarts at 1 (the `${` counts as the open brace); balancing it pops back
 * into the template.
 */
interface BraceScope {
  depth: number;
  enclosing: number[];
}

/**
 * Scans template text from `i`, just inside the template. Returns the index
 * after the closing backtick, or after a `${` — which opens a nested scope in
 * `scope` that the caller scans as code.
 */
const scanTemplate = (code: string, i: number, scope: BraceScope): number => {
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\\') {
      i += 2;
    } else if (ch === '`') {
      return i + 1;
    } else if (ch === '$' && code[i + 1] === '{') {
      scope.enclosing.push(scope.depth);
      scope.depth = 1;
      return i + 2;
    } else {
      i++;
    }
  }
  return i;
};

/**
 * Index just past the string, template, comment or regex literal starting at
 * `i`; `i` itself when plain code starts there, `-1` when a comment never ends.
 */
const skipToken = (code: string, i: number, scope: BraceScope): number => {
  if (code[i] === '"' || code[i] === "'") return skipQuoted(code, i);
  if (code[i] === '`') return scanTemplate(code, i + 1, scope);
  const afterComment = skipComment(code, i);
  return afterComment !== i ? afterComment : skipRegex(code, i);
};

/** Change in nesting depth from the heading char at `i` of a class. */
const headingDepthDelta = (code: string, i: number): number => {
  const ch = code[i];
  if ('{([<'.includes(ch)) return 1;
  if ('})]'.includes(ch)) return -1;
  // The `>` of an arrow type (`() => void`) doesn't close a `<`.
  return ch === '>' && code[i - 1] !== '=' ? -1 : 0;
};

/**
 * Finds the `{` that opens the body of the class starting at `classStart`:
 * the first one at the top level of the heading. The heading can hold braces
 * of its own — type literals in generic arguments
 * (`extends Dialog<{open: boolean}>`), options passed to a mixin
 * (`extends Mixin(Base, {shadow: true})`) — so anything nested in `<…>`,
 * `(…)` or `[…]` is skipped, along with strings and comments.
 */
const findClassBodyOpen = (code: string, classStart: number): number => {
  let depth = 0;
  let i = classStart + 'class'.length;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(code, i);
      continue;
    }
    const afterComment = skipComment(code, i);
    if (afterComment === -1) return -1;
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (ch === '{' && depth === 0) return i;
    depth += headingDepthDelta(code, i);
    i++;
  }
  return -1;
};

/**
 * Finds the index after the closing `}` of a class body starting at
 * `classStart`. Skips braces inside strings, comments, regex literals, and
 * template literals — including code in `${…}` interpolations, where nested
 * templates (Lit's `html\`…\`` inside `.map()` etc.) recurse arbitrarily.
 */
const findClassBodyEnd = (code: string, classStart: number): number => {
  const open = findClassBodyOpen(code, classStart);
  if (open === -1) return -1;
  const scope: BraceScope = {depth: 1, enclosing: []};
  let i = open + 1;
  while (i < code.length) {
    const ch = code[i];
    const afterToken = skipToken(code, i, scope);
    if (afterToken === -1) return -1;
    if (afterToken !== i) {
      i = afterToken;
      continue;
    }
    if (ch === '{') {
      scope.depth++;
    } else if (ch === '}' && --scope.depth === 0) {
      if (scope.enclosing.length === 0) return i + 1;
      // The interpolation is balanced: back into the template text.
      scope.depth = scope.enclosing.pop() ?? 0;
      i = scanTemplate(code, i + 1, scope);
      continue;
    }
    i++;
  }
  return -1;
};

const makeAssignment = (
  className: string,
  filePath: string,
  lineNumber: number
) =>
  `${className}[${SOURCE_META_SYM}]={filePath:${JSON.stringify(filePath)},lineNumber:${lineNumber},componentName:${JSON.stringify(className)}};`;

/**
 * True when `className` is declared at module top level (column 0). Nested
 * declarations are skipped deliberately: the metadata assignment for this path
 * is appended at the end of the module, where a function/block-scoped binding
 * would not be in scope (a `ReferenceError` at module evaluation).
 */
const isClassDeclaredInModule = (code: string, className: string): boolean =>
  new RegExp(
    `^(?:export\\s+)?(?:class|let|const|var)\\s+${className}\\b`,
    'm'
  ).test(code);

/** True when `index` starts a line (module top level in emitted output). */
const isAtLineStart = (code: string, index: number): boolean =>
  index === 0 || code[index - 1] === '\n';

/**
 * Injects component source metadata onto custom element class constructors.
 * Returns whether any injection was made.
 */
export const injectSourceMeta = (
  code: string,
  filePath: string,
  ms: MagicString
): boolean => {
  if (code.includes(SOURCE_META_SYM)) {
    return false;
  }
  let changed = false;
  const injected = new Set<string>();

  const injectAtClassEnd = (
    className: string,
    matchIndex: number,
    match: string
  ) => {
    if (injected.has(className)) return;
    const classOffset = match.indexOf('class');
    if (classOffset === -1) return;
    const classStart = matchIndex + classOffset;
    const end = findClassBodyEnd(code, classStart);
    if (end === -1) return;
    // Report the match start (the `@customElement` decorator) rather than the
    // `class` keyword, so the overlay points at the top of the component.
    const line = lineNumberAt(code, matchIndex);
    // Insert right after the class body so the assignment lives in the same
    // scope as the declaration — appending at module end breaks for a class
    // declared inside a function or block.
    ms.appendLeft(end, '\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  };

  // @customElement(...) class Foo (any whitespace between them)
  for (const m of code.matchAll(
    /@customElement\s*\([^)]*\)\s+(?:export\s+)?class\s+(\w+)/g
  )) {
    injectAtClassEnd(m[1], m.index, m[0]);
  }

  // customElements.define('tag', ClassName)
  for (const m of code.matchAll(
    /customElements\.define\s*\(\s*['"][^'"]+['"]\s*,\s*(\w+)/g
  )) {
    const className = m[1];
    if (injected.has(className) || !isClassDeclaredInModule(code, className)) {
      continue;
    }
    const line = lineNumberAt(code, m.index);
    ms.append('\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  }

  // TypeScript experimental-decorators / esbuild output
  // e.g. `Foo = __decorateClass([customElement(...)], Foo)`
  //       `Foo = _decorate([customElement(...)], Foo)`
  for (const m of code.matchAll(
    /(\w+)\s*=\s*__decorate\w*\(\s*\[[\s\S]*?customElement\s*\([^)]*\)[\s\S]*?\],\s*\1\)/g
  )) {
    const className = m[1];
    if (injected.has(className) || !isAtLineStart(code, m.index)) continue;
    const line = lineNumberAt(code, m.index);
    ms.append('\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  }

  return changed;
};
