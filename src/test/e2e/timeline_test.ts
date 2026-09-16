/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as http from 'node:http';
import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import {type Fixture, sameOriginHeaders, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
});

afterAll(async () => {
  await fixture?.close();
});

const getUrl = (
  port: number,
  path: string
): Promise<{status: number; headers: http.IncomingHttpHeaders; body: string}> =>
  new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${port}${path}`,
      {headers: sameOriginHeaders(port, 'GET')},
      (res) => {
        let body = '';
        let resolved = false;
        const done = () => {
          if (resolved) return;
          resolved = true;
          resolve({status: res.statusCode ?? 0, headers: res.headers, body});
        };
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', done);
        // SSE connections never end; destroy after we've collected headers and
        // resolve on the resulting 'close' event.
        res.on('close', done);
        if (res.headers['content-type']?.includes('event-stream')) {
          setTimeout(() => res.destroy(), 50);
        }
      }
    );
    req.on('error', reject);
  });

const port = (): number => {
  const address = fixture.server.httpServer!.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('server has no address');
  }
  return (address as {port: number}).port;
};

test('SSE endpoint returns text/event-stream content-type', async () => {
  const result = await getUrl(port(), '/__lit-devtools-events');
  expect(result.headers['content-type']).toBe('text/event-stream');
});

test('panel HTML is served at /__lit-devtools/', async () => {
  const result = await getUrl(port(), '/__lit-devtools/');
  expect(result.status).toBe(200);
  expect(result.headers['content-type']).toMatch(/text\/html/);
  expect(result.body).toContain('<lit-devtools-panel>');
  // Entry script injected via /@fs/ so Vite can transform TypeScript
  expect(result.body).toContain('/@fs');
  expect(result.body).toContain('lit-devtools-panel');
});

const postControl = (
  p: number,
  headers: Record<string, string>
): Promise<number> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: p,
        path: '/__lit-devtools-control',
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...headers},
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify({recording: true}));
    req.end();
  });

test('control endpoint accepts recording state via POST', async () => {
  const p = port();
  expect(await postControl(p, sameOriginHeaders(p))).toBe(204);
});

// The other tests here always send the same-origin headers, so on their own
// they would still pass if the trust check stopped rejecting anything. This
// is the case that fails loudly if it does.
test('control endpoint rejects a request with no origin signals', async () => {
  expect(await postControl(port(), {})).toBe(403);
});

test('timeline runtime script is injected into served HTML', async () => {
  const {page} = fixture;
  const srcs = await page.evaluate(() =>
    Array.from(document.scripts).map((s) => s.src)
  );
  expect(
    srcs.some((s) => s.includes('timeline') && s.includes('install'))
  ).toBe(true);
});
