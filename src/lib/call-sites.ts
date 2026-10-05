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

/** `html`/`svg` template literals, as their quasis with raw-text offsets. */
const findTemplates = (node: unknown, code: string, out: Quasi[][]): void => {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) findTemplates(item, code, out);
    return;
  }
  const record = node as Record<string, unknown>;
  if (record.type === 'TaggedTemplateExpression') {
    const tag = record.tag as {type?: string; name?: string} | undefined;
    const quasi = record.quasi as {quasis?: unknown[]} | undefined;
    if (
      tag?.type === 'Identifier' &&
      (tag.name === 'html' || tag.name === 'svg') &&
      quasi?.quasis
    ) {
      const quasis: Quasi[] = [];
      for (const q of quasi.quasis as {
        start: number;
        value: {raw: string};
      }[]) {
        // Depending on the language the parser reports a quasi's span with
        // or without its delimiter (the backtick or the `}`).
        const {raw} = q.value;
        const at = [q.start + 1, q.start].find((i) => code.startsWith(raw, i));
        if (at === undefined) {
          quasis.length = 0;
          break;
        }
        quasis.push({start: at, raw});
      }
      if (quasis.length > 0) out.push(quasis);
    }
  }
  for (const key in record) {
    if (key === 'parent') continue;
    findTemplates(record[key], code, out);
  }
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
  found: (nameEnd: number, lt: number) => void
): void => {
  let state: State = {kind: 'text'};
  for (const {start, raw} of chunks) {
    let i = 0;
    while (i < raw.length) {
      if (state.kind === 'text') {
        const lt = raw.indexOf('<', i);
        if (lt === -1) break;
        if (raw.startsWith('<!--', lt)) {
          state = {kind: 'comment'};
          i = lt + 4;
        } else if (raw[lt + 1] === '/') {
          state = {kind: 'tag', quote: null, rawText: null};
          i = lt + 2;
        } else {
          TAG_NAME_RE.lastIndex = lt + 1;
          const m = TAG_NAME_RE.exec(raw);
          if (!m) {
            i = lt + 1;
            continue;
          }
          const nameEnd = lt + 1 + m[0].length;
          const next = raw[nameEnd];
          // A name that runs into `${` is only partly known: don't stamp.
          if (
            next !== undefined &&
            /[\s>/]/.test(next) &&
            CUSTOM_NAME_RE.test(m[0])
          ) {
            found(start + nameEnd, start + lt);
          }
          const lower = m[0].toLowerCase();
          state = {
            kind: 'tag',
            quote: null,
            rawText: RAW_TEXT_ELEMENTS.has(lower) ? lower : null,
          };
          i = nameEnd;
        }
      } else if (state.kind === 'comment') {
        const end = raw.indexOf('-->', i);
        if (end === -1) break;
        state = {kind: 'text'};
        i = end + 3;
      } else if (state.kind === 'raw') {
        const re = new RegExp(`</${state.name}(?=[\\s>/])`, 'ig');
        re.lastIndex = i;
        const m = re.exec(raw);
        if (!m) break;
        state = {kind: 'tag', quote: null, rawText: null};
        i = m.index + m[0].length;
      } else {
        const tag: Extract<State, {kind: 'tag'}> = state;
        const ch = raw[i++];
        if (tag.quote) {
          if (ch === tag.quote) tag.quote = null;
        } else if (ch === '"' || ch === "'") {
          tag.quote = ch;
        } else if (ch === '>') {
          state = tag.rawText
            ? {kind: 'raw', name: tag.rawText}
            : {kind: 'text'};
        }
      }
    }
  }
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

  const lineStarts = [0];
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) {
    lineStarts.push(i + 1);
  }
  const position = (index: number): string => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return `${lo + 1}:${index - lineStarts[lo] + 1}`;
  };

  let changed = false;
  for (const quasis of templates) {
    scanCustomTags(quasis, (nameEnd, lt) => {
      ms.appendLeft(nameEnd, ` ${CALL_SITE_ATTR}="${wire}:${position(lt)}"`);
      changed = true;
    });
  }
  return changed;
};
