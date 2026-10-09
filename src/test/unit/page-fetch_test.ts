import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {withPageFetch} from '../../lib/devframe/page-fetch.js';
import {withDefineSources} from '../../lib/devframe/define-sources.js';
import {createSourceMapResolver} from '../../lib/devframe/source-maps.js';
import {createNullSource} from '../../lib/devframe/source.js';
import type {TimelineSink, TimelineSource} from '../../lib/devframe/source.js';
import type {
  InspectorCommand,
  InspectorMessage,
} from '../../types/inspector.js';

/** A source whose page messages the test pushes; and what reached the sink. */
const harness = (
  onCommand: (
    cmd: InspectorCommand,
    push: (m: InspectorMessage) => void
  ) => void = () => {}
) => {
  let sink: TimelineSink | undefined;
  const sent: InspectorCommand[] = [];
  const push = (m: InspectorMessage) => sink!.inspectorMessage(m);
  const inner: TimelineSource = {
    ...createNullSource(),
    attach(s) {
      sink = s;
      return () => {};
    },
    sendInspector(cmd) {
      sent.push(cmd);
      onCommand(cmd, push);
    },
  };
  return {inner, sent, push, sink: () => sink!};
};

const attachTo = (source: TimelineSource) => {
  const got: InspectorMessage[] = [];
  source.attach({
    pushEvents() {},
    addLayer() {},
    hmrIncompatible() {},
    hmrPatched() {},
    runtimeReady() {},
    inspectorMessage: (m) => void got.push(m),
  });
  return got;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('withPageFetch', () => {
  test('asks the page and reads the reply, without forwarding it', async () => {
    const h = harness();
    const page = withPageFetch(h.inner);
    const got = attachTo(page.source);
    const res = page.fetch('https://app.test/a.js');
    expect(h.sent).toEqual([
      {type: 'fetch-text', url: 'https://app.test/a.js'},
    ]);
    h.push({
      type: 'fetched-text',
      url: 'https://app.test/a.js',
      ok: true,
      text: 'code',
      sourceMap: 'a.js.map',
    });
    const r = await res;
    expect(r.ok).toBe(true);
    expect(r.headers.get('SourceMap')).toBe('a.js.map');
    expect(r.headers.get('Content-Type')).toBeNull();
    expect(await r.text()).toBe('code');
    expect(got).toEqual([]);
  });

  test('passes other messages on', () => {
    const h = harness();
    const got = attachTo(withPageFetch(h.inner).source);
    h.push({type: 'gone', id: 1});
    expect(got).toEqual([{type: 'gone', id: 1}]);
  });

  test('a refused fetch is not ok', async () => {
    const h = harness((cmd, push) => {
      if (cmd.type === 'fetch-text') {
        push({type: 'fetched-text', url: cmd.url, ok: false});
      }
    });
    const page = withPageFetch(h.inner);
    attachTo(page.source);
    const r = await page.fetch('https://cdn.test/x.js');
    expect(r.ok).toBe(false);
  });

  test('gives up on a page that never answers', async () => {
    vi.useFakeTimers();
    const h = harness();
    const page = withPageFetch(h.inner, 100);
    attachTo(page.source);
    const res = page.fetch('https://app.test/a.js');
    await vi.advanceTimersByTimeAsync(100);
    expect((await res).ok).toBe(false);
  });

  test('concurrent asks for one url share a command', async () => {
    const h = harness();
    const page = withPageFetch(h.inner);
    attachTo(page.source);
    const a = page.fetch('https://app.test/a.js');
    const b = page.fetch('https://app.test/a.js');
    void page.fetch('https://app.test/b.js');
    expect(h.sent.map((c) => (c as {url: string}).url)).toEqual([
      'https://app.test/a.js',
      'https://app.test/b.js',
    ]);
    h.push({type: 'fetched-text', url: 'https://app.test/a.js', ok: true});
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
  });

  test('a send that throws reads as a failed fetch', async () => {
    const h = harness(() => {
      throw new Error('no channel');
    });
    const page = withPageFetch(h.inner);
    attachTo(page.source);
    expect((await page.fetch('https://app.test/a.js')).ok).toBe(false);
  });
});

describe('define sources through the page', () => {
  test('maps define frames through a map the page fetched', async () => {
    const map = JSON.stringify({
      version: 3,
      file: 'a.js',
      sources: ['src/a.ts'],
      names: [],
      mappings: 'AAAA',
    });
    const code = `//# sourceMappingURL=data:application/json;base64,${btoa(map)}`;
    const frames = [{url: 'https://app.test/a.js', line: 1, column: 1}];
    const h = harness((cmd, push) => {
      if (cmd.type === 'define-frames') {
        push({type: 'define-frames', frames: {0: frames}});
      } else if (cmd.type === 'fetch-text') {
        push({type: 'fetched-text', url: cmd.url, ok: true, text: code});
      }
    });
    const page = withPageFetch(h.inner);
    const resolver = createSourceMapResolver({fetch: page.fetch});
    const got = attachTo(
      withDefineSources(page.source, (f) => resolver.resolve(f))
    );
    h.sink().inspectorMessage({
      type: 'tree',
      roots: [{id: 1, tagName: 'x-a', defineId: 0, children: []}],
    } as InspectorMessage);
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]).toMatchObject({
      type: 'tree',
      roots: [{source: {file: 'src/a.ts', line: 1, column: 1}}],
    });
  });
});
