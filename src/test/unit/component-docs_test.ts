import {describe, expect, it} from 'vite-plus/test';
import {
  createComponentDocsIndex,
  type DocsFs,
} from '../../lib/component-docs/load.js';
import {docsFromManifest} from '../../lib/component-docs/manifest.js';

const origin = {manifest: 'custom-elements.json'};

const manifestWith = (...declarations: unknown[]) => ({
  schemaVersion: '2.1.0',
  modules: [{kind: 'javascript-module', path: 'src/x.js', declarations}],
});

const element = (tagName: string, extra: Record<string, unknown> = {}) => ({
  kind: 'class',
  customElement: true,
  name: 'X',
  tagName,
  ...extra,
});

describe('docsFromManifest', () => {
  it('maps every member kind', () => {
    const [docs] = docsFromManifest(
      manifestWith(
        element('my-button', {
          name: 'MyButton',
          summary: ' A button ',
          description: 'Click **me**.\n',
          deprecated: 'use my-btn',
          members: [
            {
              kind: 'field',
              name: 'size',
              description: 'How big.',
              type: {text: "'s' | 'm'"},
              default: "'m'",
              attribute: 'size',
              deprecated: true,
              inheritedFrom: {name: 'Base', module: 'base.js'},
            },
            {kind: 'field', name: '_secret', privacy: 'private'},
            {kind: 'field', name: 'guarded', privacy: 'protected'},
            {kind: 'field', name: 'registry', static: true},
            {kind: 'method', name: 'click'},
            {kind: 'field', name: 'open', privacy: 'public'},
          ],
          attributes: [
            {
              name: 'size',
              fieldName: 'size',
              type: {text: 'string'},
              default: 'm',
            },
            {name: 'data-x', inheritedFrom: {name: 'Base'}},
          ],
          events: [
            {name: 'press', type: {text: 'CustomEvent'}},
            {description: 'nameless'},
          ],
          slots: [
            {name: '', description: 'Default'},
            {name: 'icon'},
            {description: 'no name key'},
          ],
          cssParts: [{name: 'base', description: 'The button.'}],
          cssProperties: [
            {name: '--color', default: 'red', syntax: '<color>'},
            {name: '--gap', type: {text: 'length'}},
          ],
          cssStates: [{name: 'busy'}],
        })
      ),
      {package: '@acme/ui', manifest: 'cem.json'}
    );
    expect(docs).toMatchObject({
      tagName: 'my-button',
      className: 'MyButton',
      summary: 'A button',
      description: 'Click **me**.',
      deprecated: 'use my-btn',
      origin: {package: '@acme/ui', manifest: 'cem.json', module: 'src/x.js'},
    });
    expect(docs.properties).toEqual([
      {
        name: 'size',
        description: 'How big.',
        type: "'s' | 'm'",
        default: "'m'",
        deprecated: true,
        counterpart: 'size',
        inheritedFrom: 'Base',
      },
      {name: 'open'},
    ]);
    expect(docs.attributes).toEqual([
      {name: 'size', type: 'string', default: 'm', counterpart: 'size'},
      {name: 'data-x', inheritedFrom: 'Base'},
    ]);
    expect(docs.events).toEqual([{name: 'press', type: 'CustomEvent'}]);
    expect(docs.slots).toEqual([
      {name: '', description: 'Default'},
      {name: 'icon'},
      {name: '', description: 'no name key'},
    ]);
    expect(docs.cssParts).toEqual([{name: 'base', description: 'The button.'}]);
    expect(docs.cssProperties).toEqual([
      {name: '--color', default: 'red', type: '<color>'},
      {name: '--gap', type: 'length'},
    ]);
    expect(docs.cssStates).toEqual([{name: 'busy'}]);
  });

  it('leaves out absent optional keys entirely', () => {
    const [docs] = docsFromManifest(
      manifestWith(element('a-b', {description: '  ', deprecated: false})),
      origin
    );
    expect(Object.keys(docs).sort()).toEqual(
      [
        'attributes',
        'className',
        'cssParts',
        'cssProperties',
        'cssStates',
        'events',
        'origin',
        'properties',
        'slots',
        'tagName',
      ].sort()
    );
    expect(docs.origin).toEqual({
      manifest: 'custom-elements.json',
      module: 'src/x.js',
    });
  });

  it('skips non-elements and elements without a tag name', () => {
    const docs = docsFromManifest(
      manifestWith(
        {kind: 'class', name: 'Plain'},
        element('', {}),
        {kind: 'class', customElement: true, name: 'NoTag'},
        element('kept-one')
      ),
      origin
    );
    expect(docs.map((d) => d.tagName)).toEqual(['kept-one']);
  });

  it('never throws on malformed input', () => {
    const junk: unknown[] = [
      undefined,
      null,
      42,
      'x',
      [],
      {},
      {modules: 'no'},
      {modules: [null, 1, {declarations: 'x'}, {declarations: [null, 'x', 3]}]},
      manifestWith(
        element('ok-tag', {
          members: 'x',
          attributes: [null, 1, {}],
          events: {},
          slots: [[]],
        })
      ),
      manifestWith(
        element('ok-tag', {
          members: [null, {kind: 'field'}, {kind: 'field', name: 5}],
        })
      ),
    ];
    for (const manifest of junk)
      expect(() => docsFromManifest(manifest, origin)).not.toThrow();
    expect(docsFromManifest(junk[8], origin)[0]?.properties).toEqual([]);
    expect(docsFromManifest(junk[9], origin)[0]?.properties).toEqual([]);
  });
});

/** An in-memory tree: path -> contents and mtime. */
const memoryFs = (
  files: Record<string, string | {text: string; mtime: number}>
) => {
  const tree = new Map<string, {text: string; mtime: number}>();
  const set = (path: string, value: string | {text: string; mtime: number}) =>
    tree.set(path, typeof value === 'string' ? {text: value, mtime: 1} : value);
  for (const [path, value] of Object.entries(files)) set(path, value);
  const reads: string[] = [];
  const fs: DocsFs = {
    readFile: (path) => {
      reads.push(path);
      return tree.get(path)?.text;
    },
    mtime: (path) => tree.get(path)?.mtime,
  };
  return {fs, set, reads, remove: (path: string) => tree.delete(path)};
};

const manifestJson = (...tags: string[]) =>
  JSON.stringify(
    manifestWith(...tags.map((tag) => element(tag, {description: tag})))
  );

const indexOver = (fs: DocsFs, root: string | undefined) =>
  createComponentDocsIndex({root: () => root, fs: () => fs});

describe('createComponentDocsIndex', () => {
  it('reads the project manifest from the customElements field', async () => {
    const {fs} = memoryFs({
      '/p/package.json': JSON.stringify({customElements: 'dist/cem.json'}),
      '/p/dist/cem.json': manifestJson('own-tag'),
    });
    const docs = await indexOver(fs, '/p').get('own-tag');
    expect(docs?.origin).toEqual({
      manifest: 'dist/cem.json',
      module: 'src/x.js',
    });
    expect(await indexOver(fs, '/p').get('nope-tag')).toBeNull();
  });

  it('falls back to custom-elements.json and walks up from the root', async () => {
    const {fs} = memoryFs({
      '/p/package.json': '{}',
      '/p/custom-elements.json': manifestJson('own-tag'),
    });
    expect((await indexOver(fs, '/p/src/deep').get('own-tag'))?.tagName).toBe(
      'own-tag'
    );
  });

  it('finds dependencies, including hoisted ones two levels up', async () => {
    const {fs} = memoryFs({
      '/mono/apps/web/package.json': JSON.stringify({
        dependencies: {'@acme/ui': '1', plain: '1'},
        devDependencies: {dev: '1'},
      }),
      '/mono/node_modules/@acme/ui/package.json': JSON.stringify({
        name: '@acme/ui',
        customElements: './cem.json',
      }),
      '/mono/node_modules/@acme/ui/cem.json': manifestJson('ui-card'),
      '/mono/apps/node_modules/plain/package.json': JSON.stringify({}),
      '/mono/apps/node_modules/plain/custom-elements.json':
        manifestJson('plain-el'),
      '/mono/apps/web/node_modules/dev/package.json': JSON.stringify({
        name: 'dev-real',
      }),
      '/mono/apps/web/node_modules/dev/custom-elements.json':
        manifestJson('dev-el'),
    });
    const index = indexOver(fs, '/mono/apps/web');
    expect((await index.get('ui-card'))?.origin).toEqual({
      package: '@acme/ui',
      manifest: 'cem.json',
      module: 'src/x.js',
    });
    expect((await index.get('plain-el'))?.origin.package).toBe('plain');
    expect((await index.get('dev-el'))?.origin.package).toBe('dev-real');
  });

  it('does not recurse into dependencies of dependencies', async () => {
    const {fs} = memoryFs({
      '/p/package.json': JSON.stringify({dependencies: {a: '1'}}),
      '/p/node_modules/a/package.json': JSON.stringify({
        dependencies: {b: '1'},
      }),
      '/p/node_modules/b/package.json': '{}',
      '/p/node_modules/b/custom-elements.json': manifestJson('b-el'),
    });
    expect(await indexOver(fs, '/p').get('b-el')).toBeNull();
  });

  it('prefers the project, then dependencies in discovery order', async () => {
    const {fs} = memoryFs({
      '/p/package.json': JSON.stringify({
        dependencies: {first: '1', second: '1'},
      }),
      '/p/custom-elements.json': manifestJson('shared-a'),
      '/p/node_modules/first/package.json': '{}',
      '/p/node_modules/first/custom-elements.json': manifestJson(
        'shared-a',
        'shared-b'
      ),
      '/p/node_modules/second/package.json': '{}',
      '/p/node_modules/second/custom-elements.json': manifestJson(
        'shared-b',
        'shared-c'
      ),
    });
    const index = indexOver(fs, '/p');
    expect((await index.get('shared-a'))?.origin.package).toBeUndefined();
    expect((await index.get('shared-b'))?.origin.package).toBe('first');
    expect((await index.get('shared-c'))?.origin.package).toBe('second');
  });

  it('skips missing and invalid files quietly', async () => {
    const {fs} = memoryFs({
      '/p/package.json': JSON.stringify({
        customElements: 'broken.json',
        dependencies: {bad: '1', missing: '1', good: '1', '../evil': '1'},
      }),
      '/p/broken.json': '{not json',
      '/p/node_modules/bad/package.json': '{nope',
      '/p/node_modules/good/package.json': '{}',
      '/p/node_modules/good/custom-elements.json': manifestJson('good-el'),
    });
    expect((await indexOver(fs, '/p').get('good-el'))?.tagName).toBe('good-el');
  });

  it('rejects a customElements path that escapes the package', async () => {
    const {fs} = memoryFs({
      '/p/package.json': JSON.stringify({
        customElements: '../x.json',
        dependencies: {dep: '1'},
      }),
      '/x.json': manifestJson('escaped'),
      '/p/node_modules/dep/package.json': JSON.stringify({
        customElements: '/abs/cem.json',
      }),
      '/abs/cem.json': manifestJson('absolute'),
      '/p/node_modules/dep/../cem.json': manifestJson('sneaky'),
    });
    const index = indexOver(fs, '/p');
    expect(await index.get('escaped')).toBeNull();
    expect(await index.get('absolute')).toBeNull();
    expect(await index.get('sneaky')).toBeNull();
  });

  it('returns null without a root or a package.json', async () => {
    const {fs} = memoryFs({'/p/custom-elements.json': manifestJson('lonely')});
    expect(await indexOver(fs, undefined).get('lonely')).toBeNull();
    expect(await indexOver(fs, '/p').get('lonely')).toBeNull();
  });

  it('serves from cache until a file changes', async () => {
    const {fs, set, reads} = memoryFs({
      '/p/package.json': JSON.stringify({dependencies: {dep: '1'}}),
      '/p/node_modules/dep/package.json': '{}',
      '/p/node_modules/dep/custom-elements.json': manifestJson('dep-el'),
    });
    const index = indexOver(fs, '/p');
    expect((await index.get('dep-el'))?.description).toBe('dep-el');
    const readsAfterFirst = reads.length;
    await index.get('dep-el');
    await index.get('missing-el');
    expect(reads.length).toBe(readsAfterFirst);

    set('/p/node_modules/dep/custom-elements.json', {
      text: JSON.stringify(
        manifestWith(element('dep-el', {description: 'changed'}))
      ),
      mtime: 2,
    });
    expect((await index.get('dep-el'))?.description).toBe('changed');
    // Only the manifest was re-read, not package.json files.
    expect(reads.slice(readsAfterFirst)).toEqual([
      '/p/node_modules/dep/custom-elements.json',
    ]);
  });

  it('rediscovers when the project package.json changes and notices a new own manifest', async () => {
    const {fs, set, remove} = memoryFs({'/p/package.json': '{}'});
    const index = indexOver(fs, '/p');
    expect(await index.get('own-tag')).toBeNull();

    set('/p/custom-elements.json', manifestJson('own-tag'));
    expect((await index.get('own-tag'))?.tagName).toBe('own-tag');

    set('/p/package.json', {
      text: JSON.stringify({customElements: 'other.json'}),
      mtime: 2,
    });
    set('/p/other.json', manifestJson('other-tag'));
    expect((await index.get('other-tag'))?.tagName).toBe('other-tag');
    expect(await index.get('own-tag')).toBeNull();

    remove('/p/other.json');
    expect(await index.get('other-tag')).toBeNull();
  });

  it('handles Windows-style roots', async () => {
    const {fs} = memoryFs({
      'C:/proj/package.json': JSON.stringify({dependencies: {dep: '1'}}),
      'C:/node_modules/dep/package.json': '{}',
      'C:/node_modules/dep/custom-elements.json': manifestJson('win-el'),
    });
    expect(
      (await indexOver(fs, 'C:\\proj').get('win-el'))?.origin.package
    ).toBe('dep');
  });
});
