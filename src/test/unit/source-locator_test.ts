import {describe, expect, test} from 'vite-plus/test';
import {createSourceLocator, sourceRootsOf} from '../../lib/source-locator.js';

// Real repo directories rather than temp ones, so the confinement cases run
// against existing files and a committed symlink.
const repoPath = (relative: string) =>
  decodeURIComponent(new URL(relative, import.meta.url).pathname);
const appRoot = repoPath('../../lib');
const pkgRoot = repoPath('../fixtures');
const outsideFile = repoPath('../../../package.json');

describe('sourceRootsOf', () => {
  test('puts the Vite root first, then server.fs.allow', () => {
    expect(
      sourceRootsOf({root: '/proj/app', server: {fs: {allow: ['/proj']}}})
    ).toEqual(['/proj/app', '/proj']);
    expect(sourceRootsOf({root: '/proj/app', server: {}})).toEqual([
      '/proj/app',
    ]);
  });
});

describe('toWire', () => {
  const at = (root: string) => createSourceLocator([root]);

  test('strips the root from files inside it', () => {
    expect(at('/proj').toWire('/proj/src/a.ts')).toBe('src/a.ts');
  });

  test('works for a filesystem root', () => {
    expect(at('/').toWire('/src/a.ts')).toBe('src/a.ts');
  });

  test('leaves a sibling that shares the root prefix alone', () => {
    expect(at('/proj').toWire('/proj-other/a.ts')).toBe('/proj-other/a.ts');
  });

  test('leaves files outside the primary root alone', () => {
    const locator = createSourceLocator(['/proj/app', '/proj']);
    expect(locator.toWire('/proj/lib/a.ts')).toBe('/proj/lib/a.ts');
  });

  test('is a no-op without roots', () => {
    expect(createSourceLocator([]).toWire('/proj/a.ts')).toBe('/proj/a.ts');
  });

  test('uses forward slashes on Windows, whichever separator Vite used', () => {
    const locator = createSourceLocator(['C:\\proj'], 'win32');
    expect(locator.toWire('C:\\proj\\src\\a.ts')).toBe('src/a.ts');
    expect(locator.toWire('C:/proj/src/a.ts')).toBe('src/a.ts');
  });

  test('leaves a file on another Windows drive alone', () => {
    const locator = createSourceLocator(['C:\\proj'], 'win32');
    expect(locator.toWire('D:\\lib\\a.ts')).toBe('D:\\lib\\a.ts');
  });
});

describe('resolve', () => {
  const locator = createSourceLocator([appRoot, pkgRoot]);

  test('resolves a wire path against the primary root', () => {
    expect(locator.resolve('confine.ts')).toEqual({
      path: `${appRoot}/confine.ts`,
    });
  });

  test('round-trips a file through the wire', () => {
    const file = `${appRoot}/plugins/context.ts`;
    expect(locator.resolve(locator.toWire(file))).toEqual({path: file});
  });

  test('accepts an absolute path beneath another root', () => {
    const sibling = `${pkgRoot}/client-types/consumer.ts`;
    expect(locator.resolve(sibling)).toEqual({path: sibling});
  });

  test.each([
    ['an absolute path outside every root', outsideFile],
    ['traversal out of the roots', '../../package.json'],
    ['a sibling sharing a root as prefix', `${appRoot}-evil/confine.ts`],
    // A committed symlink to the repo's LICENSE: beneath `pkgRoot` by name,
    // outside every root once resolved.
    ['a symlink out of a root', `${pkgRoot}/escape`],
  ])('refuses %s', (_, file) => {
    expect(locator.resolve(file)).toEqual({failure: 'outside'});
  });

  test('reports a missing file apart from a refused one', () => {
    expect(locator.resolve('missing.ts')).toEqual({failure: 'missing'});
  });

  test('refuses everything without roots', () => {
    expect(createSourceLocator([]).resolve('confine.ts')).toEqual({
      failure: 'outside',
    });
  });
});
