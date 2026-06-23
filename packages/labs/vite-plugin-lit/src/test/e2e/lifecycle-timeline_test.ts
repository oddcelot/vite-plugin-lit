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

const port = (): number => {
  const address = fixture.server.httpServer!.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('server has no address');
  }
  return (address as {port: number}).port;
};

/** POST a JSON body to a dev-server endpoint, resolving the status code. */
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

// Regression guard: the lifecycle layer must instrument *every* Lit element via
// the shared base prototype (not just the first registered one, and regardless
// of whether the prod Lit build exposes `reactiveElementVersions`). We record,
// drive an update on the lifecycle demo child, and confirm the phase events
// flow over the SSE channel the panel consumes.
test('lifecycle layer reports update phases over SSE', async () => {
  const {page} = fixture;

  // Subscribe to the same SSE stream the panel uses and buffer the events.
  await page.evaluate(() => {
    const w = window as unknown as {__tl: unknown[]; __es?: EventSource};
    w.__tl = [];
    const es = new EventSource('/__lit-devtools-events');
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const batch = JSON.parse(e.data) as unknown[];
        if (Array.isArray(batch)) w.__tl.push(...batch);
      } catch {
        // ignore non-JSON keep-alives
      }
    };
    w.__es = es;
  });

  // Turn recording on (relayed to the page runtime over HMR).
  expect(await post('/__lit-devtools-control', {recording: true})).toBe(204);

  // Poll: nudge an update on the demo child each round (recording/SSE may not
  // be wired on the first tick) until the lifecycle phases show up.
  const titlesSeen = async (): Promise<string[]> => {
    await page.evaluate(() => {
      const child = document
        .querySelector('hmr-lifecycle')
        ?.shadowRoot?.querySelector('hmr-lifecycle-child') as
        | {requestUpdate?: () => void}
        | null
        | undefined;
      child?.requestUpdate?.();
    });
    return page.evaluate(() =>
      (
        window as unknown as {__tl: Array<{layerId?: string; title?: string}>}
      ).__tl
        .filter((e) => e.layerId === 'lit-lifecycle')
        .map((e) => e.title ?? '')
    );
  };

  await expect
    .poll(async () => (await titlesSeen()).includes('performUpdate:start'), {
      timeout: 10_000,
    })
    .toBe(true);

  const titles = new Set(await titlesSeen());
  // The full update cycle: performUpdate brackets willUpdate, update, updated.
  for (const phase of ['performUpdate', 'willUpdate', 'update', 'updated']) {
    expect(titles.has(`${phase}:start`)).toBe(true);
    expect(titles.has(`${phase}:end`)).toBe(true);
  }
});
