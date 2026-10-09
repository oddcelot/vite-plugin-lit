import {describe, expect, test} from 'vite-plus/test';
import {parseStackFrames} from '../../lib/runtime/define-sites.js';

describe('parseStackFrames', () => {
  test('reads V8 frames, innermost first, and drops non-http ones', () => {
    const stack = [
      'Error',
      '    at registry.define (chrome-extension://abcdef/page.js:1:2345)',
      '    at customElements.define (chrome-extension://abcdef/page.js:1:999)',
      '    at customElement (https://app.test/assets/index-abc.js:12:3401)',
      '    at https://app.test/assets/index-abc.js:40:17',
      '    at async loadRoute (https://app.test/assets/route.js:3:8)',
      '    at new Foo (http://localhost:8080/foo.js:2:1)',
      '    at Object.<anonymous> (https://app.test/a.js?v=1:5:6)',
      '    at eval (eval at <anonymous> (https://app.test/a.js:1:1), <anonymous>:1:1)',
      '    at <anonymous>',
      '    at Array.forEach (<anonymous>)',
    ].join('\n');
    expect(parseStackFrames(stack)).toEqual([
      {url: 'https://app.test/assets/index-abc.js', line: 12, column: 3401},
      {url: 'https://app.test/assets/index-abc.js', line: 40, column: 17},
      {url: 'https://app.test/assets/route.js', line: 3, column: 8},
      {url: 'http://localhost:8080/foo.js', line: 2, column: 1},
      {url: 'https://app.test/a.js?v=1', line: 5, column: 6},
    ]);
  });

  test('reads Firefox and Safari frames', () => {
    const stack =
      'define@moz-extension://x/page.js:1:2\n' +
      'customElement@https://app.test/a.js:7:9\n' +
      '@https://app.test/a.js:20:1\n';
    expect(parseStackFrames(stack)).toEqual([
      {url: 'https://app.test/a.js', line: 7, column: 9},
      {url: 'https://app.test/a.js', line: 20, column: 1},
    ]);
  });

  test('keeps at most `max` frames', () => {
    const stack = Array.from(
      {length: 12},
      (_, i) => `    at f${i} (https://app.test/a.js:${i + 1}:1)`
    ).join('\n');
    expect(parseStackFrames(stack)).toHaveLength(8);
    expect(parseStackFrames(stack, 2).map((f) => f.line)).toEqual([1, 2]);
  });

  test('an empty or foreign stack has no frames', () => {
    expect(parseStackFrames('')).toEqual([]);
    expect(parseStackFrames('Error\n    at file:///x/a.js:1:1')).toEqual([]);
  });
});
