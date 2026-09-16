/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type MagicString from 'magic-string';

/** Stable key shared between transform output and runtime resolution. */
export const SOURCE_META_KEY = '@lit-labs/vite-plugin-lit#source';

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
 * Finds the index after the closing `}` of a class body starting at
 * `classStart`. Skips braces inside strings, comments, regex literals, and
 * template literals — including code in `${…}` interpolations, where nested
 * templates (Lit's `html\`…\`` inside `.map()` etc.) recurse arbitrarily.
 */
const findClassBodyEnd = (code: string, classStart: number): number => {
  const open = code.indexOf('{', classStart);
  if (open === -1) return -1;
  // Brace depth of the code scope currently being scanned. Entering a `${…}`
  // interpolation pushes the enclosing scope's depth and restarts at 1 (the
  // `${` counts as the open brace); balancing it pops back into the template.
  let depth = 1;
  const interpolationStack: number[] = [];
  let inTemplate = false;
  let i = open + 1;
  while (i < code.length) {
    const ch = code[i];
    if (inTemplate) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        inTemplate = false;
        i++;
        continue;
      }
      if (ch === '$' && code[i + 1] === '{') {
        interpolationStack.push(depth);
        depth = 1;
        inTemplate = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i++;
      continue;
    }
    if (ch === '/') {
      const next = code[i + 1];
      if (next === '/') {
        i = code.indexOf('\n', i);
        if (i === -1) return -1;
        continue;
      }
      if (next === '*') {
        i = code.indexOf('*/', i + 2);
        if (i === -1) return -1;
        i += 2;
        continue;
      }
      // Regex literal vs division: scan back over whitespace to the last
      // significant char — a regex can only follow an operator, opening
      // punctuation, or a keyword like `return`. `a / b` has an identifier
      // there, so it's division and scans on as plain code.
      let j = i - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      const prev = j >= 0 ? code[j] : '';
      const regexPossible =
        j < 0 ||
        /[=:(,+\-!&|?{}[;]/.test(prev) ||
        /(?:^|[^\w$])(?:return|typeof|case|instanceof|in|of|new|delete|void|throw|do|else|yield|await)$/.test(
          code.slice(Math.max(0, j - 11), j + 1)
        );
      if (regexPossible) {
        let k = i + 1;
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
        if (code[k] === '/') {
          i = k + 1;
          continue;
        }
        // No closing `/` before the line ends — not a regex after all.
      }
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const enclosing = interpolationStack.pop();
        if (enclosing === undefined) {
          return i + 1;
        }
        depth = enclosing;
        inTemplate = true;
      }
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

/** True when `className` is declared as a class/let/const in module code. */
const isClassDeclaredInModule = (code: string, className: string): boolean =>
  new RegExp(
    `^\\s*(?:export\\s+)?(?:class|let|const|var)\\s+${className}\\b`,
    'm'
  ).test(code);

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
    ms.append('\n' + makeAssignment(className, filePath, line));
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
    if (injected.has(className)) continue;
    const line = lineNumberAt(code, m.index);
    ms.append('\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  }

  return changed;
};
