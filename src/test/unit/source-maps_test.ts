import {describe, expect, test} from 'vite-plus/test';
import MagicString from 'magic-string';
import {
  createSourceMapResolver,
  decodeDataUrl,
  displayPath,
  sourceMappingUrlOf,
} from '../../lib/devframe/source-maps.js';
import type {GeneratedFrame} from '../../types/inspector.js';

// The resolver against an in-memory site: scripts and maps by URL, every
// fetch recorded. Maps are built with magic-string, prepending a header so
// generated and original lines differ.

interface Served {
  body: string;
  headers?: Record<string, string>;
  status?: number;
}

const site = (files: Record<string, Served | Error>) => {
  const fetched: string[] = [];
  const fetchStub = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    fetched.push(url);
    const file = files[url];
    if (file instanceof Error) throw file;
    if (file === undefined) return new Response('not found', {status: 404});
    return new Response(file.body, {
      status: file.status ?? 200,
      headers: file.headers,
    });
  }) as typeof fetch;
  return {fetch: fetchStub, fetched};
};

const HEADER = '/* bundle */\n/* more */\n';

/** A generated script for `original` and its map, with `source` named in it. */
const bundle = (original: string, source: string) => {
  const ms = new MagicString(original);
  ms.prepend(HEADER);
  const map = ms.generateMap({source, hires: true});
  return {code: ms.toString(), map: map.toString()};
};

const ORIGINAL = `import {LitElement} from 'lit';\nclass MyEl extends LitElement {}\ncustomElements.define('my-el', MyEl);\n`;
// `customElements.define(` on original line 3, column 0 (1-based: 1).
const frameAt = (url: string, column = 1): GeneratedFrame => ({
  url,
  line: 5,
  column,
});

const base64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('sourceMappingUrlOf', () => {
  test('takes the last comment, either prefix', () => {
    expect(
      sourceMappingUrlOf(
        'a\n//# sourceMappingURL=first.map\nb\n//@ sourceMappingURL=last.map\n'
      )
    ).toBe('last.map');
    expect(sourceMappingUrlOf('no map here')).toBeUndefined();
  });
});

describe('decodeDataUrl', () => {
  test('reads base64 and percent-encoded payloads', () => {
    const json = '{"version":3,"é":1}';
    expect(
      decodeDataUrl(
        `data:application/json;charset=utf-8;base64,${base64(json)}`
      )
    ).toBe(json);
    expect(
      decodeDataUrl(`data:application/json,${encodeURIComponent(json)}`)
    ).toBe(json);
  });
});

describe('displayPath', () => {
  test('strips schemes, hosts and leading dots to a project path', () => {
    expect(displayPath('webpack://my-app/./src/a.ts')).toBe('src/a.ts');
    expect(displayPath('webpack:///src/a.ts')).toBe('src/a.ts');
    expect(displayPath('https://app.test/src/a.ts?v=1')).toBe('src/a.ts');
    expect(displayPath('file:///home/me/app/src/a.ts')).toBe(
      '/home/me/app/src/a.ts'
    );
    expect(displayPath('https://app.test/src/my%20el.ts')).toBe('src/my el.ts');
  });
});

describe('createSourceMapResolver', () => {
  test('maps through an external map, relative to the script', async () => {
    const {code, map} = bundle(ORIGINAL, '../src/my-el.ts');
    const {fetch, fetched} = site({
      'https://app.test/assets/index.js': {
        body: `${code}\n//# sourceMappingURL=index.js.map\n`,
      },
      'https://app.test/assets/index.js.map': {body: map},
    });
    const resolver = createSourceMapResolver({fetch});
    const frame = frameAt('https://app.test/assets/index.js', 16);
    expect(await resolver.resolve([frame])).toEqual({
      file: 'src/my-el.ts',
      line: 3,
      column: 16,
      url: 'https://app.test/src/my-el.ts',
      generated: frame,
    });
    expect(fetched).toEqual([
      'https://app.test/assets/index.js',
      'https://app.test/assets/index.js.map',
    ]);
  });

  test('fetches nothing the site does not allow', async () => {
    const {code, map} = bundle(ORIGINAL, '../src/my-el.ts');
    const {fetch, fetched} = site({
      'https://cdn.test/el.js': {body: code},
      'https://app.test/main.js': {
        body: `${code}\n//# sourceMappingURL=https://maps.test/main.js.map\n`,
      },
      'https://maps.test/main.js.map': {body: map},
    });
    const resolver = createSourceMapResolver({
      fetch,
      allows: (url) => new URL(url).origin === 'https://app.test',
    });
    expect(
      await resolver.resolve([
        frameAt('https://cdn.test/el.js'),
        frameAt('https://app.test/main.js'),
      ])
    ).toBeUndefined();
    expect(fetched).toEqual(['https://app.test/main.js']);
  });

  test('reads an inline base64 map', async () => {
    const {code, map} = bundle(ORIGINAL, 'webpack://app/./src/my-el.ts');
    const {fetch} = site({
      'https://app.test/main.js': {
        body: `${code}\n//# sourceMappingURL=data:application/json;base64,${base64(map)}\n`,
      },
    });
    const source = await createSourceMapResolver({fetch}).resolve([
      frameAt('https://app.test/main.js'),
    ]);
    expect(source).toMatchObject({
      file: 'src/my-el.ts',
      line: 3,
      column: 1,
      url: 'webpack://app/src/my-el.ts',
    });
  });

  test('reads an inline percent-encoded map', async () => {
    const {code, map} = bundle(ORIGINAL, 'my-el.ts');
    const {fetch} = site({
      'https://app.test/src/main.js': {
        body: `${code}\n//# sourceMappingURL=data:application/json,${encodeURIComponent(map)}\n`,
      },
    });
    const source = await createSourceMapResolver({fetch}).resolve([
      frameAt('https://app.test/src/main.js'),
    ]);
    expect(source).toMatchObject({
      file: 'src/my-el.ts',
      url: 'https://app.test/src/my-el.ts',
    });
  });

  test('prefers the SourceMap header to a comment', async () => {
    const {code, map} = bundle(ORIGINAL, 'src/my-el.ts');
    const {fetch} = site({
      'https://app.test/a.js': {
        body: `${code}\n//# sourceMappingURL=wrong.map\n`,
        headers: {SourceMap: '/maps/a.js.map'},
      },
      'https://app.test/maps/a.js.map': {body: map},
    });
    const source = await createSourceMapResolver({fetch}).resolve([
      frameAt('https://app.test/a.js'),
    ]);
    expect(source?.url).toBe('https://app.test/maps/src/my-el.ts');
  });

  test('skips node_modules frames, then Lit packages', async () => {
    const lit = bundle(ORIGINAL, '../node_modules/@lit/reactive-element/x.js');
    const lib = bundle(ORIGINAL, '../node_modules/some-ui/button.js');
    const app = bundle(ORIGINAL, '../src/my-el.ts');
    const served = (name: string, b: {code: string; map: string}) => ({
      [`https://app.test/assets/${name}.js`]: {
        body: `${b.code}\n//# sourceMappingURL=${name}.js.map\n`,
      },
      [`https://app.test/assets/${name}.js.map`]: {body: b.map},
    });
    const {fetch} = site({
      ...served('lit', lit),
      ...served('lib', lib),
      ...served('app', app),
    });
    const resolver = createSourceMapResolver({fetch});
    const at = (name: string) => frameAt(`https://app.test/assets/${name}.js`);

    expect(
      (await resolver.resolve([at('lit'), at('lib'), at('app')]))?.file
    ).toBe('src/my-el.ts');
    expect((await resolver.resolve([at('lit'), at('lib')]))?.file).toBe(
      'node_modules/some-ui/button.js'
    );
    expect((await resolver.resolve([at('lit')]))?.file).toBe(
      'node_modules/@lit/reactive-element/x.js'
    );
  });

  test('unmapped frames fall through to a mapped one', async () => {
    const {code, map} = bundle(ORIGINAL, '../src/my-el.ts');
    const {fetch} = site({
      'https://app.test/plain.js': {body: 'no map'},
      'https://app.test/assets/a.js': {
        body: `${code}\n//# sourceMappingURL=a.js.map\n`,
      },
      'https://app.test/assets/a.js.map': {body: map},
    });
    const source = await createSourceMapResolver({fetch}).resolve([
      frameAt('https://app.test/plain.js'),
      frameAt('https://app.test/assets/a.js'),
    ]);
    expect(source?.file).toBe('src/my-el.ts');
  });

  test('no map, a failed fetch or a broken map leave it unknown', async () => {
    const {fetch} = site({
      'https://app.test/plain.js': {body: 'console.log(1)'},
      'https://app.test/down.js': new TypeError('Failed to fetch'),
      'https://app.test/bad.js': {
        body: 'x\n//# sourceMappingURL=bad.js.map\n',
      },
      'https://app.test/bad.js.map': {body: '{not json'},
      'https://app.test/gone.js': {
        body: 'x\n//# sourceMappingURL=gone.js.map\n',
      },
      'https://app.test/404.js': {body: 'nope', status: 404},
    });
    const resolver = createSourceMapResolver({fetch});
    for (const name of ['plain', 'down', 'bad', 'gone', '404']) {
      expect(
        await resolver.resolve([frameAt(`https://app.test/${name}.js`)])
      ).toBeUndefined();
    }
    expect(await resolver.resolve([])).toBeUndefined();
  });

  test('fetches each script once until reset', async () => {
    const {code, map} = bundle(ORIGINAL, 'my-el.ts');
    const {fetch, fetched} = site({
      'https://app.test/a.js': {
        body: `${code}\n//# sourceMappingURL=a.js.map\n`,
      },
      'https://app.test/a.js.map': {body: map},
    });
    const resolver = createSourceMapResolver({fetch});
    const frame = frameAt('https://app.test/a.js');
    await Promise.all([
      resolver.resolve([frame]),
      resolver.resolve([frame, frame]),
    ]);
    await resolver.resolve([frame]);
    expect(fetched).toHaveLength(2);
    resolver.reset();
    await resolver.resolve([frame]);
    expect(fetched).toHaveLength(4);
  });
});
