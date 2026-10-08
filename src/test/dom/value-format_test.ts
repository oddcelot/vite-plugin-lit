import {expect, test} from 'vite-plus/test';
import {serialize} from '../../lib/runtime/inspector/serialize.js';
import {
  formatLines,
  formatValue,
  tokenizeValue,
  type ValueToken,
} from '../../panel/value-format.js';

/** `kind:text` pairs without the spaces, for compact expectations. */
const kinds = (tokens: ValueToken[]) =>
  tokens.filter((t) => t.text.trim() !== '').map((t) => `${t.kind}:${t.text}`);

const text = (tokens: ValueToken[]) => tokens.map((t) => t.text).join('');

test('colours keys, strings, numbers and keywords in an object', () => {
  const value = serialize({id: 1, name: 'Ada', ok: true, gone: null});
  expect(kinds(tokenizeValue(value))).toEqual([
    'punct:{',
    'key:id',
    'punct::',
    'number:1',
    'punct:,',
    'key:name',
    'punct::',
    'string:"Ada"',
    'punct:,',
    'key:ok',
    'punct::',
    'keyword:true',
    'punct:,',
    'key:gone',
    'punct::',
    'keyword:null',
    'punct:}',
  ]);
});

test('keeps every character of the preview', () => {
  class Point {
    x = 1;
    y = -2.5;
  }
  const circular: Record<string, unknown> = {big: 12n};
  circular['self'] = circular;
  for (const value of [
    new Point(),
    circular,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'x'.repeat(200),
    function onClick() {},
    new Map([[1, 2]]),
    new Date(0),
    /ab+c/gi,
    Symbol('s'),
    document.createElement('div'),
  ]) {
    const preview = serialize(value);
    expect(text(tokenizeValue(preview))).toBe(preview);
  }
});

test('names class instances, functions and elements', () => {
  class Point {
    x = 1;
  }
  expect(kinds(tokenizeValue(serialize(new Point())))[0]).toBe('type:Point');
  expect(kinds(tokenizeValue(serialize(function onClick() {})))).toEqual([
    'muted:ƒ',
    'callee:onClick',
    'punct:(',
    'punct:)',
  ]);
  const el = document.createElement('div');
  el.id = 'app';
  expect(kinds(tokenizeValue(serialize(el)))).toContain('tag:div');
});

test('mutes the serializer placeholders', () => {
  const circular: Record<string, unknown> = {};
  circular['self'] = circular;
  expect(kinds(tokenizeValue(serialize(circular)))).toContain('muted:Circular');
  const many = kinds(tokenizeValue(serialize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])));
  expect(many.slice(-4)).toEqual(['muted:…', 'muted:+', 'muted:2', 'punct:]']);
});

test('a short preview stays on one line', () => {
  expect(text(formatValue('{a: 1, b: 2}'))).toBe('{a: 1, b: 2}');
});

test('a long object opens up one entry per line', () => {
  const value = serialize({
    id: 1,
    name: 'Ada Lovelace',
    bio: 'wrote the first program before computers existed',
  });
  expect(text(formatValue(value))).toBe(
    [
      '{',
      '  id: 1,',
      '  name: "Ada Lovelace",',
      '  bio: "wrote the first program before computers existed"',
      '}',
    ].join('\n')
  );
});

test('nested groups open only where they do not fit', () => {
  const value = serialize({
    user: {first: 'Ada', last: 'Lovelace'},
    tags: ['math', 'engines', 'poetry', 'notes', 'letters'],
  });
  expect(text(formatValue(value))).toBe(
    [
      '{',
      '  user: {first: "Ada", last: "Lovelace"},',
      '  tags: [',
      '    "math",',
      '    "engines",',
      '    "poetry",',
      '    "notes",',
      '    "letters"',
      '  ]',
      '}',
    ].join('\n')
  );
});

test('an unbalanced preview is left as it came', () => {
  const value = `{a: "${'x'.repeat(40)}", b: [1, 2}`;
  expect(text(formatValue(value))).toBe(value);
});

test('a re-flowed preview splits into indented lines', () => {
  const value = serialize({
    user: {first: 'Ada', last: 'Lovelace'},
    tags: ['math', 'engines', 'poetry', 'notes', 'letters'],
  });
  const lines = formatLines(value).map((l) => `${l.indent}|${text(l.tokens)}`);
  expect(lines).toEqual([
    '0|{',
    '2|user: {first: "Ada", last: "Lovelace"},',
    '2|tags: [',
    '4|"math",',
    '4|"engines",',
    '4|"poetry",',
    '4|"notes",',
    '4|"letters"',
    '2|]',
    '0|}',
  ]);
});

test('a short preview is one line at no indent', () => {
  expect(formatLines('{a: 1}')).toEqual([
    {indent: 0, tokens: tokenizeValue('{a: 1}')},
  ]);
});

test('colours a Map preview and opens it up when long', () => {
  const map = new Map<string, unknown>([
    ['first', 'Ada'],
    ['last', 'Lovelace'],
    ['born', 1815],
  ]);
  const value = serialize(map);
  expect(kinds(tokenizeValue(value)).slice(0, 9)).toEqual([
    'type:Map',
    'punct:(',
    'number:3',
    'punct:)',
    'punct:{',
    'string:"first"',
    'punct:=',
    'punct:>',
    'string:"Ada"',
  ]);
  expect(text(formatValue(value))).toBe(
    [
      'Map(3) {',
      '  "first" => "Ada",',
      '  "last" => "Lovelace",',
      '  "born" => 1815',
      '}',
    ].join('\n')
  );
});
