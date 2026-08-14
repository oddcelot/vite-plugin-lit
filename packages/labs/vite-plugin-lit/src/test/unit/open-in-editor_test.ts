/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeEach, describe, expect, test, vi} from 'vitest';
import {createOpenInEditorMiddleware} from '../../lib/plugin.js';

/**
 * The middleware spawns the user's editor on the requested path, so its path
 * confinement is a security boundary. It must honour *all* allowed roots —
 * in monorepos, component sources live outside the served app's root, in
 * sibling packages that vite serves via `server.fs.allow`.
 */

const launchMock = vi.hoisted(() =>
  vi.fn(
    (
      file: string,
      cb: (fileName: string, errorMessage: string | null) => void
    ) => cb(file, null)
  )
);

vi.mock('launch-editor', () => ({default: launchMock}));

const appRoot = mkdtempSync(join(tmpdir(), 'lit-oie-app-'));
const uiRoot = mkdtempSync(join(tmpdir(), 'lit-oie-ui-'));
const outside = mkdtempSync(join(tmpdir(), 'lit-oie-outside-'));

const appFile = join(appRoot, 'app-element.ts');
const uiFile = join(uiRoot, 'ui-element.ts');
const outsideFile = join(outside, 'secrets.ts');
for (const f of [appFile, uiFile, outsideFile]) {
  writeFileSync(f, '// test fixture\n');
}

afterAll(() => {
  for (const dir of [appRoot, uiRoot, outside]) {
    rmSync(dir, {recursive: true, force: true});
  }
});

beforeEach(() => {
  launchMock.mockClear();
});

const run = (
  middleware: ReturnType<typeof createOpenInEditorMiddleware>,
  query: string,
  headers: {origin?: string; host?: string} = {}
) =>
  new Promise<{status: number; body: string}>((resolve, reject) => {
    const res = {
      statusCode: 200,
      end: (msg: string) => resolve({status: res.statusCode, body: msg}),
    };
    middleware({url: `/?${query}`, headers}, res, (err?: unknown) =>
      reject(err ?? new Error('middleware fell through to next()'))
    );
  });

describe('createOpenInEditorMiddleware', () => {
  const middleware = createOpenInEditorMiddleware([appRoot, uiRoot]);

  test('opens a file under the primary root', async () => {
    const {status, body} = await run(
      middleware,
      `file=${encodeURIComponent(appFile)}&line=14`
    );
    expect(status).toBe(200);
    expect(body).toBe('ok');
    expect(launchMock).toHaveBeenCalledWith(
      `${appFile}:14:1`,
      expect.any(Function)
    );
  });

  test('opens a file under an additional allowed root', async () => {
    const {status, body} = await run(
      middleware,
      `file=${encodeURIComponent(uiFile)}&line=3`
    );
    expect(status).toBe(200);
    expect(body).toBe('ok');
    expect(launchMock).toHaveBeenCalledWith(
      `${uiFile}:3:1`,
      expect.any(Function)
    );
  });

  test('resolves a relative file against the primary root', async () => {
    const {status} = await run(middleware, 'file=app-element.ts');
    expect(status).toBe(200);
    expect(launchMock).toHaveBeenCalledWith(
      `${appFile}:1:1`,
      expect.any(Function)
    );
  });

  test('rejects a file outside every allowed root', async () => {
    const {status, body} = await run(
      middleware,
      `file=${encodeURIComponent(outsideFile)}`
    );
    expect(status).toBe(403);
    expect(body).toBe('file outside allowed roots');
    expect(launchMock).not.toHaveBeenCalled();
  });

  test('rejects path traversal out of the allowed roots', async () => {
    const {status} = await run(
      middleware,
      `file=${encodeURIComponent(`../${outside.split('/').pop()}/secrets.ts`)}`
    );
    expect(status).toBe(403);
    expect(launchMock).not.toHaveBeenCalled();
  });

  test('rejects a sibling directory sharing the root as prefix', async () => {
    const sibling = `${uiRoot}-evil`;
    writeFileSync(`${sibling}.ts`, '');
    try {
      const {status} = await run(
        middleware,
        `file=${encodeURIComponent(`${sibling}.ts`)}`
      );
      expect(status).toBe(403);
    } finally {
      rmSync(`${sibling}.ts`, {force: true});
    }
  });

  test('404s a missing file under an allowed root', async () => {
    const {status, body} = await run(
      middleware,
      `file=${encodeURIComponent(join(uiRoot, 'nope.ts'))}`
    );
    expect(status).toBe(404);
    expect(body).toBe('file not found');
  });

  test('400s a request without a file parameter', async () => {
    const {status} = await run(middleware, 'line=1');
    expect(status).toBe(400);
  });

  test('rejects cross-origin requests', async () => {
    const {status, body} = await run(
      middleware,
      `file=${encodeURIComponent(appFile)}`,
      {origin: 'http://evil.test', host: 'localhost:5173'}
    );
    expect(status).toBe(403);
    expect(body).toBe('forbidden');
    expect(launchMock).not.toHaveBeenCalled();
  });
});
