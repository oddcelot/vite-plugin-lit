/**
 * @license
 * Copyright 2026 oddcelot
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {CSSOptions, Plugin} from 'vite';
import {parseAst} from 'vite';
import MagicString from 'magic-string';
import {JS_FILE_RE} from './shared.js';

/**
 * A `css` tagged template literal with no interpolations and no escape
 * sequences — the only kind we can hand to a CSS parser as-is. Literals
 * with `${…}` holes or backslashes are left untouched.
 */
interface CssLiteral {
  /** Offset of the literal's content, just after the opening backtick. */
  start: number;
  /** Offset just before the closing backtick. */
  end: number;
  /** Raw source text between the backticks. */
  raw: string;
}

/**
 * Reads a `TaggedTemplateExpression` AST node and returns the literal we can
 * safely hand to Lightning CSS, or `null` if it isn't a bare `css` tag, has
 * interpolations, or contains an escape sequence.
 */
const asCssLiteral = (node: Record<string, unknown>): CssLiteral | null => {
  const tag = node.tag as Record<string, unknown> | undefined;
  // The lookbehind in the old regex kept `unsafeCSS`/`myCss`-style tags and
  // member-expression tags (`x.css`) from matching; requiring a bare
  // `Identifier` named `css` does the same.
  if (!tag || tag.type !== 'Identifier' || tag.name !== 'css') {
    return null;
  }
  const quasi = node.quasi as Record<string, unknown> | undefined;
  const expressions = quasi?.expressions as unknown[] | undefined;
  // quasis.length === expressions.length + 1, so no expressions means
  // exactly one quasi holding the whole literal.
  if (!expressions || expressions.length !== 0) {
    return null;
  }
  const quasis = quasi?.quasis as Array<Record<string, unknown>> | undefined;
  const element = quasis?.[0];
  const value = element?.value as {raw?: string} | undefined;
  const raw = value?.raw;
  if (typeof raw !== 'string' || raw.trim() === '' || raw.includes('\\')) {
    return null;
  }
  const start = element?.start;
  const end = element?.end;
  if (typeof start !== 'number' || typeof end !== 'number') {
    return null;
  }
  return {start, end, raw};
};

/**
 * Walks the parsed AST looking for `css` tagged template literals. Recurses
 * into every property (skipping `parent` to avoid cycles) since a literal
 * can appear anywhere an expression can — this is what tells a real literal
 * apart from `css\`` text sitting inside a string, a comment, or another
 * template literal's text, none of which produce a matching AST node.
 */
const findCssLiterals = (node: unknown, out: CssLiteral[]): void => {
  if (node === null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      findCssLiterals(item, out);
    }
    return;
  }
  const record = node as Record<string, unknown>;
  if (record.type === 'TaggedTemplateExpression') {
    const literal = asCssLiteral(record);
    if (literal) {
      out.push(literal);
    }
  }
  for (const key in record) {
    if (key === 'parent') {
      continue;
    }
    findCssLiterals(record[key], out);
  }
};

/**
 * Runs Vite's configured Lightning CSS over `css` tagged template literals
 * in user modules, which the CSS pipeline itself never sees (they're plain
 * JS strings to it). Inert unless `css.transformer` is `'lightningcss'`;
 * options come from `css.lightningcss`, so component styles get the same
 * treatment (targets, drafts, …) as `.css` files. Applies in dev and build.
 */
export const litCssLiterals = (): Plugin => {
  let lightningcss: typeof import('lightningcss') | null = null;
  let options: CSSOptions['lightningcss'];
  let minify = false;
  return {
    name: 'lit-css-literals',
    async configResolved(config) {
      if (config.css.transformer !== 'lightningcss') {
        return;
      }
      // The transformer setting guarantees the dependency: Vite itself
      // can't process .css files without it.
      lightningcss = await import('lightningcss');
      // cssModules makes no sense for a literal; everything else carries
      // over.
      const {cssModules: _cssModules, ...rest} = config.css.lightningcss ?? {};
      options = rest;
      minify = config.command === 'build';
    },
    transform(code, id) {
      if (lightningcss === null) {
        return null;
      }
      if (id.startsWith('\0') || id.includes('/node_modules/')) {
        return null;
      }
      const [file] = id.split('?', 2);
      if (!JS_FILE_RE.test(file) || !code.includes('css`')) {
        return null;
      }
      let ast: unknown;
      try {
        ast = parseAst(code, {sourceType: 'module'}, file);
      } catch {
        return null;
      }
      const literals: CssLiteral[] = [];
      findCssLiterals(ast, literals);
      if (literals.length === 0) {
        return null;
      }
      const ms = new MagicString(code);
      let changed = false;
      for (const {start, end, raw} of literals) {
        let out: string;
        try {
          const result = lightningcss.transform({
            ...options,
            filename: file,
            code: Buffer.from(raw),
            minify,
          });
          out = Buffer.from(result.code).toString();
        } catch (e) {
          this.warn(
            `[lit-plugin] skipping css literal Lightning CSS couldn't parse: ${
              (e as Error).message
            }`
          );
          continue;
        }
        // Re-escape for the template literal the output goes back into.
        out = out.replace(/[\\`$]/g, '\\$&');
        if (out !== raw) {
          ms.overwrite(start, end, out);
          changed = true;
        }
      }
      if (!changed) {
        return null;
      }
      return {code: ms.toString(), map: ms.generateMap({hires: true})};
    },
  };
};
