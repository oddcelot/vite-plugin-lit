/**
 * Turns the inspector's one-line value previews (see `serialize.ts` on the
 * page side) into coloured tokens, broken across lines when they are long.
 *
 * Previews are JS-literal shaped: `{id: 1, name: "Ada"}`, `[1, 2, …+3]`,
 * `MyClass {…}`, `ƒ onClick()`, `<div#app>`, `[Circular]`. sugar-high's core
 * lexer splits them; this module only renames its token types to what a value
 * reader cares about and re-flows bracket groups that do not fit a line.
 */
import {SugarHigh, tokenize} from 'sugar-high/core';

export type ValueTokenKind =
  | 'key'
  | 'string'
  | 'number'
  | 'keyword'
  | 'type'
  | 'callee'
  | 'tag'
  | 'punct'
  | 'muted'
  | 'text';

export interface ValueToken {
  kind: ValueTokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
]);

/** Placeholders the serializer writes in place of a value. */
const PLACEHOLDERS = new Set(['Circular', 'getter threw', 'unserializable']);

const NUMBER = /^(?:\d|\.\d)/;

type Raw = {type: string; text: string};

const lex = (value: string): Raw[] =>
  tokenize(value, {keywords: KEYWORDS}).map(([t, text]) => ({
    type: SugarHigh.TokenTypes[t] ?? 'identifier',
    text,
  }));

const next = (raw: Raw[], i: number): Raw | undefined => {
  for (let j = i + 1; j < raw.length; j++) {
    if (raw[j]!.type !== 'space') return raw[j];
  }
  return undefined;
};

const prev = (raw: Raw[], i: number): Raw | undefined => {
  for (let j = i - 1; j >= 0; j--) {
    if (raw[j]!.type !== 'space') return raw[j];
  }
  return undefined;
};

/** Split a preview into coloured tokens, spaces kept as `text`. */
export const tokenizeValue = (value: string): ValueToken[] => {
  const raw = lex(value);
  return raw.map(({type, text}, i): ValueToken => {
    const after = next(raw, i)?.text;
    const before = prev(raw, i)?.text;
    if (type === 'space') return {kind: 'text', text};
    if (type === 'string') {
      // The lexer reads a bare `…` (a truncation marker) as a string.
      return {kind: text.startsWith('…') ? 'muted' : 'string', text};
    }
    if (type === 'keyword') return {kind: 'keyword', text};
    if (type === 'sign') {
      // `…+3` is one marker: keep its `+` with the ellipsis.
      if (text === '+' && raw[i - 1]?.text.startsWith('…')) {
        return {kind: 'muted', text};
      }
      return {kind: 'punct', text};
    }
    if (NUMBER.test(text)) {
      // `…+3` again: the count after the marker is not a value.
      return {
        kind:
          before === '+' && raw[i - 2]?.text.startsWith('…')
            ? 'muted'
            : 'number',
        text,
      };
    }
    if (after === ':' && before !== '?') return {kind: 'key', text};
    if (before === '[' && after === ']' && PLACEHOLDERS.has(text)) {
      return {kind: 'muted', text};
    }
    if (text === 'ƒ') return {kind: 'muted', text};
    if (before === 'ƒ') return {kind: 'callee', text};
    if (before === '<') return {kind: 'tag', text};
    if (type === 'class') return {kind: 'type', text};
    return {kind: 'text', text};
  });
};

// ---------------------------------------------------------------------------
// Re-flow
// ---------------------------------------------------------------------------

const OPEN: Record<string, string> = {'{': '}', '[': ']'};

type Node = ValueToken | Group;
interface Group {
  open: ValueToken;
  /** Comma-separated items, each a run of nodes without leading spaces. */
  items: Node[][];
  close: ValueToken;
}

const isGroup = (n: Node): n is Group => 'items' in n;

const flatWidth = (n: Node): number =>
  isGroup(n)
    ? 2 +
      n.items.reduce(
        (w, item) => w + item.reduce((a, c) => a + flatWidth(c), 0),
        0
      ) +
      Math.max(0, n.items.length - 1) * 2
    : n.text.length;

/**
 * Nest bracket groups. Returns undefined when brackets do not balance, so a
 * preview the parser misreads is shown as it came.
 */
const parseGroups = (tokens: ValueToken[]): Node[] | undefined => {
  const stack: Array<{open: ValueToken; items: Node[][]}> = [];
  const top: Node[] = [];
  const current = (): Node[] => {
    const frame = stack.at(-1);
    return frame === undefined ? top : frame.items.at(-1)!;
  };
  for (const t of tokens) {
    if (t.kind === 'punct' && OPEN[t.text] !== undefined) {
      stack.push({open: t, items: [[]]});
    } else if (t.kind === 'punct' && (t.text === '}' || t.text === ']')) {
      const frame = stack.pop();
      if (frame === undefined || OPEN[frame.open.text] !== t.text)
        return undefined;
      const items = frame.items.filter((item) => item.length > 0);
      current().push({open: frame.open, items, close: t});
    } else if (t.kind === 'punct' && t.text === ',' && stack.length > 0) {
      stack.at(-1)!.items.push([]);
    } else if (
      t.kind === 'text' &&
      t.text.trim() === '' &&
      current().length === 0
    ) {
      // Space right after `{`, `[` or `,`: re-flow writes its own.
    } else {
      current().push(t);
    }
  }
  return stack.length === 0 ? top : undefined;
};

const emit = (
  nodes: Node[],
  indent: number,
  width: number,
  out: ValueToken[]
): void => {
  for (const n of nodes) {
    if (!isGroup(n)) {
      out.push(n);
      continue;
    }
    const pad = '  '.repeat(indent);
    if (indent * 2 + flatWidth(n) <= width || n.items.length === 0) {
      out.push(n.open);
      n.items.forEach((item, i) => {
        if (i > 0)
          out.push({kind: 'punct', text: ','}, {kind: 'text', text: ' '});
        emit(item, indent, width, out);
      });
      out.push(n.close);
      continue;
    }
    out.push(n.open);
    for (const [i, item] of n.items.entries()) {
      out.push({kind: 'text', text: `\n${pad}  `});
      emit(item, indent + 1, width, out);
      if (i < n.items.length - 1) out.push({kind: 'punct', text: ','});
    }
    out.push({kind: 'text', text: `\n${pad}`}, n.close);
  }
};

/**
 * Coloured tokens for a preview, with any `{…}` or `[…]` wider than `width`
 * characters opened up one item per line. Line breaks and indentation arrive
 * as `text` tokens, so render them with `white-space: pre-wrap`.
 */
export const formatValue = (value: string, width = 40): ValueToken[] => {
  const tokens = tokenizeValue(value);
  if (value.length <= width) return tokens;
  const nodes = parseGroups(tokens);
  if (nodes === undefined) return tokens;
  const out: ValueToken[] = [];
  emit(nodes, 0, width, out);
  return out;
};

/** One line of a re-flowed preview: its depth in spaces, and its tokens. */
export interface ValueLine {
  indent: number;
  tokens: ValueToken[];
}

/**
 * {@link formatValue}, split at its line breaks. Each line's leading spaces
 * become `indent`, so a renderer can indent the whole line, wrapped
 * continuation included, rather than only its first row.
 */
export const formatLines = (value: string, width = 40): ValueLine[] => {
  const lines: ValueLine[] = [{indent: 0, tokens: []}];
  for (const token of formatValue(value, width)) {
    if (token.kind !== 'text' || !token.text.includes('\n')) {
      lines.at(-1)!.tokens.push(token);
      continue;
    }
    const [head, ...rest] = token.text.split('\n');
    if (head !== '') lines.at(-1)!.tokens.push({kind: 'text', text: head!});
    for (const part of rest) {
      const body = part.trimStart();
      lines.push({
        indent: part.length - body.length,
        tokens: body === '' ? [] : [{kind: 'text', text: body}],
      });
    }
  }
  return lines;
};
