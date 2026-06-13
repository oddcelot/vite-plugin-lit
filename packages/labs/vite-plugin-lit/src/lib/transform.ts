/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {init, parse} from 'es-module-lexer';
import MagicString from 'magic-string';
import {WRAP_TABLE} from './wrap-table.js';

/**
 * Prefix for this plugin's virtual module ids. Rewritten specifiers carry
 * the `\0` convention directly in the transformed source; Vite's
 * import-analysis resolves them through our `resolveId` and encodes the
 * `\0` for the browser, so it never reaches the network.
 */
export const VIRTUAL_PREFIX = '\0lit-plugin:';

/** Virtual module that installs the define interceptor. */
export const INSTALL_ID = `${VIRTUAL_PREFIX}install`;

const LIT_FAMILY_PACKAGES = ['lit', 'lit-html', 'lit-element'];
const LIT_FAMILY_SCOPES = ['@lit/', '@lit-labs/'];

const isLitFamilySpecifier = (spec: string): boolean =>
  LIT_FAMILY_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`)) ||
  LIT_FAMILY_SCOPES.some((s) => spec.startsWith(s));

/**
 * A module needs the define interceptor + self-accept if it registers
 * custom elements: a textual `customElements.define(` call, or — only when
 * a lit-family import is present — a `customElement(` decorator call (the
 * decorator runtime call stays textually present after TS transpilation).
 */
export const isComponentModule = (
  code: string,
  hasLitFamilyImport: boolean
): boolean =>
  code.includes('customElements.define(') ||
  (hasLitFamilyImport && /\bcustomElement\s*\(/.test(code));

export interface LitPluginTransformResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

/**
 * The whole dev transform, as a pure function of the module source:
 *
 * - Pass 1 (all user modules — shared template-partial modules must intern
 *   too): rewrite import/export-from/dynamic-import specifiers found in the
 *   wrap table to their `\0lit-plugin:` wrapper module.
 * - Pass 2 (component modules): prepend the interceptor install import
 *   (static imports hoist, so the interceptor is installed before this
 *   module's defines) and append a self-accept (re-execution alone triggers
 *   the define interceptor — no hotUpdate hook needed).
 *
 * Returns `null` when the module needs no changes.
 */
export const transformLitModule = async (
  code: string
): Promise<LitPluginTransformResult | null> => {
  // Cheap pre-filter before parsing.
  if (!code.includes('lit') && !code.includes('customElements')) {
    return null;
  }
  // Idempotency: never re-instrument our own output.
  if (code.includes(VIRTUAL_PREFIX)) {
    return null;
  }
  await init;
  let imports;
  try {
    [imports] = parse(code);
  } catch {
    // Not parseable as a module; leave it to Vite to error.
    return null;
  }
  const ms = new MagicString(code);
  let changed = false;
  let hasLitFamilyImport = false;
  for (const imp of imports) {
    const spec = imp.n;
    if (spec === undefined) {
      continue;
    }
    if (isLitFamilySpecifier(spec)) {
      hasLitFamilyImport = true;
    }
    if (!WRAP_TABLE.has(spec)) {
      continue;
    }
    if (imp.d > -1) {
      // Dynamic import: [s, e) includes the quotes (or backticks) — narrow
      // them to plain quotes around the rewritten specifier.
      ms.overwrite(imp.s, imp.e, `'${VIRTUAL_PREFIX}${spec}'`);
    } else {
      // Static import / export-from: [s, e) is the bare specifier text.
      ms.overwrite(imp.s, imp.e, `${VIRTUAL_PREFIX}${spec}`);
    }
    changed = true;
  }
  if (isComponentModule(code, hasLitFamilyImport)) {
    ms.prepend(`import '${INSTALL_ID}';\n`);
    ms.append(`\nimport.meta.hot?.accept();\n`);
    changed = true;
  }
  if (!changed) {
    return null;
  }
  return {
    code: ms.toString(),
    map: ms.generateMap({hires: 'boundary'}),
  };
};
