/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as http from 'node:http';
import {afterAll, beforeAll, expect, test} from 'vitest';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
});

afterAll(async () => {
  await fixture?.close();
});

const port = (): number =>
  (fixture.server.httpServer!.address() as {port: number}).port;

const post = (path: string, body: unknown): Promise<number> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {hostname: '127.0.0.1', port: port(), path, method: 'POST'},
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.setHeader('Content-Type', 'application/json');
    req.end(JSON.stringify(body));
  });

// The mouse/keyboard layers default off in the runtime, so they only capture
// once the panel pushes their enablement (which `_toggleRecord` now does on
// record start, alongside the recording flag — the panel SPA can't be driven in
// e2e, so this guards the runtime/relay/input path that the fix feeds). Send the
// same control payload the fixed panel sends, then dispatch input and confirm
// both layers report over SSE.
test('mouse and keyboard layers capture when enabled at record start', async () => {
  const {page} = fixture;

  await page.evaluate(() => {
    const w = window as unknown as {__tl: Array<{layerId?: string}>};
    w.__tl = [];
    const es = new EventSource('/__lit-devtools-events');
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const b = JSON.parse(e.data) as Array<{layerId?: string}>;
        if (Array.isArray(b)) w.__tl.push(...b);
      } catch {
        /* keep-alive */
      }
    };
  });

  // Mirror the fixed panel: recording flag + the full layer enablement in one
  // control post.
  expect(
    await post('/__lit-devtools-control', {
      recording: true,
      litLifecycleEnabled: true,
      litRenderEnabled: true,
      mouseEventEnabled: true,
      keyboardEventEnabled: true,
    })
  ).toBe(204);

  const layersSeen = async (): Promise<Set<string>> => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new MouseEvent('click', {clientX: 5, clientY: 5, bubbles: true})
      );
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}));
    });
    return new Set(
      await page.evaluate(() =>
        (window as unknown as {__tl: Array<{layerId?: string}>}).__tl.map(
          (e) => e.layerId ?? ''
        )
      )
    );
  };

  await expect
    .poll(async () => (await layersSeen()).has('mouse'), {timeout: 10_000})
    .toBe(true);
  const layers = await layersSeen();
  expect(layers.has('mouse')).toBe(true);
  expect(layers.has('keyboard')).toBe(true);
});
