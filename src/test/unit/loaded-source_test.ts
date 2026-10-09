import {describe, expect, test} from 'vite-plus/test';
import {loadedUrlFor} from '../../../extension/src/loaded-source.js';

describe('loadedUrlFor', () => {
  test('matches a root-relative URL, ignoring the query', () => {
    expect(
      loadedUrlFor('/home/me/app/src/x.ts', [
        'http://localhost:5173/src/other.ts',
        'http://localhost:5173/src/x.ts?t=1',
      ])
    ).toBe('http://localhost:5173/src/x.ts?t=1');
  });

  test('matches Vite’s /@fs form for a file outside the root', () => {
    expect(
      loadedUrlFor('/home/me/lib/x.ts', [
        'http://localhost:5173/@fs/home/me/lib/x.ts',
      ])
    ).toBe('http://localhost:5173/@fs/home/me/lib/x.ts');
  });

  test('prefers the longest matching pathname', () => {
    expect(
      loadedUrlFor('/home/me/app/src/x.ts', [
        'http://localhost:5173/x.ts',
        'http://localhost:5173/src/x.ts',
      ])
    ).toBe('http://localhost:5173/src/x.ts');
  });

  test('decodes the pathname', () => {
    expect(
      loadedUrlFor('/home/me/my app/x.ts', [
        'http://localhost:5173/my%20app/x.ts',
      ])
    ).toBe('http://localhost:5173/my%20app/x.ts');
  });

  test('treats a relative file as rooted', () => {
    expect(loadedUrlFor('src/x.ts', ['http://a.test/src/x.ts'])).toBe(
      'http://a.test/src/x.ts'
    );
  });

  test('never matches the page itself or a non-URL', () => {
    expect(
      loadedUrlFor('/home/me/app/src/x.ts', ['http://a.test/', 'nonsense'])
    ).toBeUndefined();
  });

  test('finds nothing for an unrelated file', () => {
    expect(
      loadedUrlFor('/home/me/app/src/x.ts', ['http://a.test/src/y.ts'])
    ).toBeUndefined();
  });
});
