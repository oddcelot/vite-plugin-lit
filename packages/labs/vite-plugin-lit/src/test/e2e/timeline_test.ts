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

const getUrl = (
  port: number,
  path: string
): Promise<{status: number; headers: http.IncomingHttpHeaders; body: string}> =>
  new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve({status: res.statusCode ?? 0, headers: res.headers, body});
      });
      // SSE connections never end; destroy after we've collected headers.
      if (res.headers['content-type']?.includes('event-stream')) {
        setTimeout(() => res.destroy(), 50);
      }
    });
    req.on('error', (err: Error) => {
      // ECONNRESET from destroy is expected for SSE — resolve with what we have
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      reject(err);
    });
    req.on('close', () => {
      // May fire before 'end' on destroyed SSE connection; noop if already resolved.
    });
  });

const port = (): number => {
  const address = fixture.server.httpServer!.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('server has no address');
  }
  return (address as {port: number}).port;
};

test('SSE endpoint returns text/event-stream content-type', async () => {
  const result = await getUrl(port(), '/__lit-timeline-events');
  expect(result.headers['content-type']).toBe('text/event-stream');
});

test('panel HTML is served at /__lit-timeline/', async () => {
  const result = await getUrl(port(), '/__lit-timeline/');
  expect(result.status).toBe(200);
  expect(result.headers['content-type']).toMatch(/text\/html/);
  expect(result.body).toContain('<timeline-app>');
  // Entry script injected via /@fs/ so Vite can transform TypeScript
  expect(result.body).toContain('/@fs');
  expect(result.body).toContain('timeline-app');
});

test('control endpoint accepts recording state via POST', async () => {
  const p = port();
  const result = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: p,
        path: '/__lit-timeline-control',
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
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
  expect(result).toBe(204);
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
