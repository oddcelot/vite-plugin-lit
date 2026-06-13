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
 * `classStart`. Brace matching only; sufficient for typical Lit component
 * classes.
 */
const findClassBodyEnd = (code: string, classStart: number): number => {
  const open = code.indexOf('{', classStart);
  if (open === -1) return -1;
  let depth = 1;
  let i = open + 1;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return depth === 0 ? i : -1;
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
    const line = lineNumberAt(code, classStart);
    ms.append('\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  };

  // @customElement(...) class Foo (same line)
  for (const m of code.matchAll(
    /@customElement\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g
  )) {
    injectAtClassEnd(m[1], m.index, m[0]);
  }

  // @customElement(...)\n class Foo (next line)
  for (const m of code.matchAll(
    /@customElement\s*\([^)]*\)\s*\n\s*(?:export\s+)?class\s+(\w+)/g
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

  // TypeScript experimental-decorators output
  // e.g. `Foo = _decorate([customElement(...)], Foo)`
  for (const m of code.matchAll(
    /(\w+)\s*=\s*_decorate\(\[customElement\s*\([^)]*\)\],\s*\1\)/g
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
