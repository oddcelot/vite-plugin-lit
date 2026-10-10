import {parseAst} from 'vite';
import type MagicString from 'magic-string';
import {CALL_SITE_ATTR} from './runtime/source-meta.js';

export {CALL_SITE_ATTR};

/** A valid custom element name, as far as a template scan needs to know. */
const CUSTOM_NAME_RE = /^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/;
const TAG_NAME_RE = /[A-Za-z][A-Za-z0-9._:-]*/y;
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
/** Characters that would break the template literal or the HTML attribute. */
const UNSAFE_WIRE_RE = /[`$\\"&<>]/;

type State =
  | {kind: 'text'}
  | {kind: 'comment'}
  | {kind: 'tag'; quote: string | null; rawText: string | null}
  | {kind: 'raw'; name: string};

const langOf = (file: string): 'ts' | 'tsx' | 'js' | 'jsx' => {
  const ext = /\.([cm]?[jt]sx?)$/.exec(file)?.[1] ?? 'js';
  if (ext.endsWith('tsx')) return 'tsx';
  if (ext.endsWith('ts')) return 'ts';
  if (ext.endsWith('jsx')) return 'jsx';
  return 'js';
};

interface Quasi {
  start: number;
  raw: string;
}

/**
 * The quasis of an `html`/`svg` tagged template with their raw-text offsets,
 * or `undefined` when `record` is not one (or a quasi cannot be located).
 */
const quasisOf = (
  record: Record<string, unknown>,
  code: string
): Quasi[] | undefined => {
  if (record.type !== 'TaggedTemplateExpression') return undefined;
  const tag = record.tag as {type?: string; name?: string} | undefined;
  const quasi = record.quasi as {quasis?: unknown[]} | undefined;
  if (
    tag?.type !== 'Identifier' ||
    (tag.name !== 'html' && tag.name !== 'svg') ||
    !quasi?.quasis
  ) {
    return undefined;
  }
  const quasis: Quasi[] = [];
  for (const q of quasi.quasis as {start: number; value: {raw: string}}[]) {
    // Depending on the language the parser reports a quasi's span with
    // or without its delimiter (the backtick or the `}`).
    const {raw} = q.value;
    const at = [q.start + 1, q.start].find((i) => code.startsWith(raw, i));
    if (at === undefined) return undefined;
    quasis.push({start: at, raw});
  }
  return quasis.length > 0 ? quasis : undefined;
};

/** `html`/`svg` template literals, as their quasis with raw-text offsets. */
const findTemplates = (node: unknown, code: string, out: Quasi[][]): void => {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) findTemplates(item, code, out);
    return;
  }
  const record = node as Record<string, unknown>;
  const quasis = quasisOf(record, code);
  if (quasis) out.push(quasis);
  for (const key in record) {
    if (key === 'parent') continue;
    findTemplates(record[key], code, out);
  }
};

/** A scanner step: the next state and offset, or `null` once the chunk is spent. */
type Step = {state: State; i: number} | null;

type Found = (nameEnd: number, lt: number) => void;

const openTag = (): State => ({kind: 'tag', quote: null, rawText: null});

/** Text: finds the next `<` and enters a comment, a closing or an opening tag. */
const scanText = (
  raw: string,
  i: number,
  start: number,
  found: Found
): Step => {
  const lt = raw.indexOf('<', i);
  if (lt === -1) return null;
  if (raw.startsWith('<!--', lt)) return {state: {kind: 'comment'}, i: lt + 4};
  if (raw[lt + 1] === '/') return {state: openTag(), i: lt + 2};
  TAG_NAME_RE.lastIndex = lt + 1;
  const m = TAG_NAME_RE.exec(raw);
  if (!m) return {state: {kind: 'text'}, i: lt + 1};
  const nameEnd = lt + 1 + m[0].length;
  const next = raw[nameEnd];
  // A name that runs into `${` is only partly known: don't stamp.
  if (next !== undefined && /[\s>/]/.test(next) && CUSTOM_NAME_RE.test(m[0])) {
    found(start + nameEnd, start + lt);
  }
  const lower = m[0].toLowerCase();
  const rawText = RAW_TEXT_ELEMENTS.has(lower) ? lower : null;
  return {state: {kind: 'tag', quote: null, rawText}, i: nameEnd};
};

/** Comment: skips past the closing `-->`. */
const scanComment = (raw: string, i: number): Step => {
  const end = raw.indexOf('-->', i);
  return end === -1 ? null : {state: {kind: 'text'}, i: end + 3};
};

/** Raw-text element: skips to the end of its closing tag's name. */
const scanRaw = (raw: string, i: number, name: string): Step => {
  const re = new RegExp(`</${name}(?=[\\s>/])`, 'ig');
  re.lastIndex = i;
  const m = re.exec(raw);
  if (!m) return null;
  return {state: openTag(), i: m.index + m[0].length};
};

/** Inside a tag: tracks attribute quotes up to the `>` that ends the tag. */
const scanTag = (
  tag: Extract<State, {kind: 'tag'}>,
  raw: string,
  i: number
): Step => {
  const ch = raw[i];
  if (tag.quote) {
    if (ch === tag.quote) tag.quote = null;
  } else if (ch === '"' || ch === "'") {
    tag.quote = ch;
  } else if (ch === '>') {
    const state: State = tag.rawText
      ? {kind: 'raw', name: tag.rawText}
      : {kind: 'text'};
    return {state, i: i + 1};
  }
  return {state: tag, i: i + 1};
};

/**
 * Walks the HTML in `chunks` (a whole document is one chunk; a template
 * literal is its quasis, which an expression may split mid-tag) and calls
 * `found(nameEnd, lt)` for each opening tag of a custom element, with the
 * offsets in the surrounding text of the end of the tag name and of its `<`.
 * Tags inside comments, attribute values and raw-text elements are skipped,
 * and so is a name that runs into an expression.
 */
export const scanCustomTags = (
  chunks: readonly Quasi[],
  found: Found
): void => {
  let state: State = {kind: 'text'};
  for (const {start, raw} of chunks) {
    let i = 0;
    while (i < raw.length) {
      let step: Step;
      if (state.kind === 'text') step = scanText(raw, i, start, found);
      else if (state.kind === 'comment') step = scanComment(raw, i);
      else if (state.kind === 'raw') step = scanRaw(raw, i, state.name);
      else step = scanTag(state, raw, i);
      if (!step) break;
      ({state, i} = step);
    }
  }
};

/** `line:col` (1-based) of a character offset in `code`. */
const positionIn = (code: string): ((index: number) => string) => {
  const lineStarts = [0];
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) {
    lineStarts.push(i + 1);
  }
  return (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return `${lo + 1}:${index - lineStarts[lo] + 1}`;
  };
};

/**
 * Stamps `data-lit-source="<wireFile>:<line>:<col>"` onto every custom
 * element opened in an `html`/`svg` tagged template, so the page can tell
 * where each instance was written. `line` and `col` are 1-based and measured
 * on the raw `code` at the tag's `<`. Returns whether anything was inserted.
 */
export const injectCallSites = (
  code: string,
  id: string,
  wireFile: string,
  ms: MagicString
): boolean => {
  const wire = wireFile.replace(/\\/g, '/');
  if (UNSAFE_WIRE_RE.test(wire)) return false;
  let ast: unknown;
  try {
    ast = parseAst(code, {sourceType: 'module', lang: langOf(id)}, id);
  } catch {
    return false;
  }
  const templates: Quasi[][] = [];
  findTemplates(ast, code, templates);
  if (templates.length === 0) return false;

  const position = positionIn(code);

  let changed = false;
  for (const quasis of templates) {
    scanCustomTags(quasis, (nameEnd, lt) => {
      ms.appendLeft(nameEnd, ` ${CALL_SITE_ATTR}="${wire}:${position(lt)}"`);
      changed = true;
    });
  }
  return changed;
};

/**
 * The HTML counterpart of {@link injectCallSites}: stamps every custom element
 * opened in an HTML entry file, with `line` and `col` measured on `html` as
 * given. Elements inside `<template>` are stamped too, since clones of them
 * keep the attribute. Returns the new HTML, or `undefined` when nothing was
 * stamped.
 */
export const injectHtmlCallSites = (
  html: string,
  wireFile: string
): string | undefined => {
  const wire = wireFile.replace(/\\/g, '/');
  if (UNSAFE_WIRE_RE.test(wire)) return undefined;
  const position = positionIn(html);
  const inserts: Array<{at: number; text: string}> = [];
  scanCustomTags([{start: 0, raw: html}], (nameEnd, lt) => {
    inserts.push({
      at: nameEnd,
      text: ` ${CALL_SITE_ATTR}="${wire}:${position(lt)}"`,
    });
  });
  if (inserts.length === 0) return undefined;
  let out = '';
  let last = 0;
  for (const {at, text} of inserts) {
    out += html.slice(last, at) + text;
    last = at;
  }
  return out + html.slice(last);
};
