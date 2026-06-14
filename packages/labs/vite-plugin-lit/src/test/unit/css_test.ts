/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterEach, describe, expect, test, vi} from 'vitest';
import {devCacheBust, urlSheet} from '../../lib/runtime/css.js';

/**
 * `urlSheet` is the extractable half of the shared-utility-sheet pattern: the
 * playground's `hmr-utility-sheet.ts` is a thin consumer of it, and the only
 * thing that *can't* be moved into the package is the literal
 * `import.meta.hot.accept` line (Vite resolves accepted HMR deps by static
 * analysis of the source, so it must appear in the importing module). These
 * tests pin the dev-time behavior that consumer relies on.
 *
 * Vitest pins `import.meta.env.DEV` to `true` and `vi.stubEnv` does not reach
 * it, so these exercise the dev branch — which is the whole reason the helper
 * exists (HMR). The production path is a one-line `!DEV` passthrough that
 * returns the hashed-asset URL unchanged; it's exercised by the e2e build.
 */

// Minimal `CSSStyleSheet` stand-in — the node test env has no DOM. Records
// every `replaceSync` so we can assert what got swapped in.
class FakeSheet {
  readonly replaced: string[] = [];
  replaceSync(css: string): void {
    this.replaced.push(css);
  }
}

const installSheet = () => {
  vi.stubGlobal('CSSStyleSheet', FakeSheet);
};

// A `fetch` that hands back fixed text per URL, recording call order.
const installFetch = (byUrl: Record<string, string>) => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(url);
      const body = byUrl[url] ?? byUrl['*'] ?? '';
      return Promise.resolve({text: () => Promise.resolve(body)});
    })
  );
  return calls;
};

const replacedOf = (sheet: CSSStyleSheet): string[] =>
  (sheet as unknown as FakeSheet).replaced;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('devCacheBust', () => {
  test('appends a cache-busting query in dev', () => {
    expect(devCacheBust('/assets/util.css')).toMatch(
      /^\/assets\/util\.css\?t=\d+$/
    );
  });
});

describe('urlSheet', () => {
  test('returns a constructed sheet plus a hot-update callback', () => {
    installSheet();
    installFetch({'*': ''});
    const result = urlSheet('/util.css');
    expect(result.sheet).toBeInstanceOf(FakeSheet);
    expect(typeof result.onHotUpdate).toBe('function');
  });

  test('fetches the css and replaceSyncs it into the sheet on construction', async () => {
    installSheet();
    installFetch({'*': '.bg-blue{background:#3b82f6}'});
    const {sheet} = urlSheet('/util.css');
    await vi.waitFor(() =>
      expect(replacedOf(sheet)).toEqual(['.bg-blue{background:#3b82f6}'])
    );
  });

  test('in dev, fetches the `direct` variant so it gets css bytes, not the JS module', async () => {
    installSheet();
    const calls = installFetch({'*': ''});
    urlSheet('/util.css');
    await vi.waitFor(() => expect(calls).toEqual(['/util.css?direct']));
  });

  test('joins `direct` with `&` when the url already carries a query', async () => {
    installSheet();
    const calls = installFetch({'*': ''});
    urlSheet('/util.css?t=123');
    await vi.waitFor(() => expect(calls).toEqual(['/util.css?t=123&direct']));
  });

  test('onHotUpdate re-fetches the new url and swaps it into the same sheet', async () => {
    installSheet();
    installFetch({
      '/util.css?direct': '.bg-blue{background:#3b82f6}',
      '/util-v2.css?direct': '.bg-blue{background:#ef4444}',
    });
    const {sheet, onHotUpdate} = urlSheet('/util.css');
    await vi.waitFor(() =>
      expect(replacedOf(sheet)).toEqual(['.bg-blue{background:#3b82f6}'])
    );

    // Vite hands the accept callback the updated module; its `default` export
    // is the fresh `?url` string.
    onHotUpdate({default: '/util-v2.css'});
    await vi.waitFor(() =>
      // Both edits landed on the *same* sheet object — adopters keep their
      // reference and never re-render.
      expect(replacedOf(sheet)).toEqual([
        '.bg-blue{background:#3b82f6}',
        '.bg-blue{background:#ef4444}',
      ])
    );
  });

  test('onHotUpdate ignores a module with no string default', async () => {
    installSheet();
    const calls = installFetch({'*': ''});
    const {onHotUpdate} = urlSheet('/util.css');
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    onHotUpdate(undefined);
    onHotUpdate({});
    onHotUpdate({default: 42 as unknown as string});
    // Still just the construction-time fetch.
    expect(calls).toHaveLength(1);
  });

  test('a failed fetch is swallowed (no unhandled rejection, sheet left empty)', async () => {
    installSheet();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network')))
    );
    const {sheet} = urlSheet('/util.css');
    // Give the rejected chain a few microtasks to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(replacedOf(sheet)).toEqual([]);
  });
});
