/**
 * Exporting a recorded session as a static panel.
 *
 * Lives with the e2e suite rather than the unit one because it runs devframe's
 * real build adapter and writes a real directory -- the interesting failures
 * (nothing baked, the SPA not copied, the per-id `component-details` records
 * missing) are all in the output, not in the call.
 *
 * It drives the definition directly through `initDevframe` rather than a
 * browser: the export reads the node side's own caches, so a page would only
 * add flakiness to what it is actually checking.
 */

import {afterEach, describe, expect, test} from 'vite-plus/test';
import {createServer as createHttpServer, type Server} from 'node:http';
import {chromium, type Browser} from 'playwright-core';
import {fsp, joinPath} from './utils.js';
import {initDevframe} from 'devframe/initiate';
import type {DevframeInstance} from 'devframe/initiate';
import {createLitDevframe} from '../../lib/devframe/definition.js';
import {createNullSource} from '../../lib/devframe/source.js';

let instance: DevframeInstance | undefined;
let server: Server | undefined;
let browser: Browser | undefined;

const TMP = './node_modules/.tmp-lit-snapshot-test';

afterEach(async () => {
  await instance?.close();
  instance = undefined;
  await browser?.close();
  browser = undefined;
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
  await fsp.rm(TMP, {recursive: true, force: true});
});

describe('static snapshot export', () => {
  test('bakes the recorded session into a self-contained panel', async () => {
    const assets = `${TMP}/assets`;
    const out = `${TMP}/out`;
    await fsp.rm(TMP, {recursive: true, force: true});
    await fsp.mkdir(assets, {recursive: true});
    // `createBuild` copies the panel SPA; the real one is `dist/client`, and
    // this test is about the dump, not about the bundle.
    await fsp.writeFile(`${assets}/index.html`, '<!doctype html>panel');

    const source = createNullSource();
    const definition = createLitDevframe({
      source,
      version: '9.9.9',
      features: () => null,
      clientAssets: assets,
      // Stand in for a session the node side recorded. The live path fills
      // these same caches from the page runtime.
      replay: {
        capturedAt: new Date().toISOString(),
        version: '9.9.9',
        customLayers: [{id: 'custom', label: 'Custom', color: 0x00ff00}],
        roots: [{id: 7, tagName: 'my-widget', children: []}],
        details: [
          {
            id: 7,
            tagName: 'my-widget',
            attributes: [],
            properties: [],
            flags: {
              hasUpdated: true,
              isUpdatePending: false,
              hasShadowRoot: true,
            },
          },
        ],
        events: [
          {layerId: 'lit-lifecycle', time: 0, data: {}, meta: {elementId: 7}},
          {layerId: 'custom', time: 5, data: {}},
        ],
        hmrIncompatibilities: [],
      },
    });

    instance = initDevframe(definition, {
      base: '/__lit/',
      distDir: false,
      ws: false,
      sse: false,
      getStorageDir: () => `${TMP}/storage`,
    });
    const ctx = await instance.context;
    await instance.ready;

    const result = await ctx.rpc.invokeLocal('lit:export-snapshot', {
      outDir: out,
    });
    expect(result).toMatchObject({events: 2, components: 1, details: 1});

    // A static deploy: nothing to dial.
    const connection = JSON.parse(
      await fsp.readFile(`${out}/__connection.json`, 'utf8')
    ) as {backend: string};
    expect(connection.backend).toBe('static');
    expect(await fsp.readFile(`${out}/index.html`, 'utf8')).toContain('panel');

    // The session itself is in there, not just the shell. The index only
    // points at shards, so read the whole dump directory.
    const shards = await fsp.readdir(`${out}/__rpc-dump`);
    const dump = (
      await Promise.all(
        shards.map((f: string) =>
          fsp.readFile(`${out}/__rpc-dump/${f}`, 'utf8')
        )
      )
    ).join('');
    expect(dump).toContain('my-widget');
    expect(dump).toContain('lit-lifecycle');
    // Without the custom layer the frozen panel shows a filter it cannot name.
    expect(dump).toContain('Custom');
    // `component-details` takes an id, so it is baked per-id rather than by
    // `snapshot: true` -- check that path specifically.
    expect(shards.some((f: string) => f.includes('component-details'))).toBe(
      true
    );
  });

  test('export-snapshot only replaces an earlier snapshot inside the cwd', async () => {
    // The build deletes `outDir` recursively before writing, and `outDir`
    // comes from whoever calls the RPC. Outside the cwd, the cwd itself, or
    // an existing directory that isn't a snapshot must all be refused before
    // anything is removed.
    const assets = `${TMP}/assets`;
    const keep = `${TMP}/not-a-snapshot`;
    await fsp.rm(TMP, {recursive: true, force: true});
    await fsp.mkdir(assets, {recursive: true});
    await fsp.mkdir(keep, {recursive: true});
    await fsp.writeFile(`${assets}/index.html`, '<!doctype html>panel');
    await fsp.writeFile(`${keep}/keep.txt`, 'mine');

    instance = initDevframe(
      createLitDevframe({
        source: createNullSource(),
        version: '9.9.9',
        features: () => null,
        clientAssets: assets,
      }),
      {
        base: '/__lit/',
        distDir: false,
        ws: false,
        sse: false,
        getStorageDir: () => `${TMP}/storage`,
      }
    );
    const ctx = await instance.context;
    await instance.ready;
    const exportTo = (outDir: string) =>
      ctx.rpc.invokeLocal('lit:export-snapshot', {outDir});

    for (const outDir of ['.', '..', joinPath(process.cwd(), '..', 'x')]) {
      await expect(exportTo(outDir)).rejects.toThrow(/must be inside/);
    }
    await expect(exportTo(keep)).rejects.toThrow(/not a snapshot/);
    expect(await fsp.readFile(`${keep}/keep.txt`, 'utf8')).toBe('mine');

    // Exporting over an earlier export is the normal case.
    await exportTo(`${TMP}/out`);
    await expect(exportTo(`${TMP}/out`)).resolves.toMatchObject({events: 0});
  });

  test('a cold-opened snapshot selects the event named in #event=', async () => {
    const out = `${TMP}/out-browser`;
    await fsp.rm(TMP, {recursive: true, force: true});

    // Enough spans that the target sits well below the first screen, so
    // "selected" and "scrolled into view" are different claims.
    const events = Array.from({length: 120}, (_, i) => [
      {
        id: `snap-${i}-s`,
        layerId: 'lit-lifecycle',
        time: i * 10,
        data: {},
        title: 'performUpdate:start',
        groupId: `7:${i}`,
        meta: {elementId: 7, tagName: 'my-widget'},
      },
      {
        id: `snap-${i}-e`,
        layerId: 'lit-lifecycle',
        time: i * 10 + 5,
        data: {},
        title: 'performUpdate:end',
        groupId: `7:${i}`,
        meta: {elementId: 7, tagName: 'my-widget'},
      },
    ]).flat();

    const definition = createLitDevframe({
      source: createNullSource(),
      version: '9.9.9',
      features: () => null,
      // The real built panel: the point is what a browser does with the bake.
      clientAssets: joinPath(process.cwd(), 'dist/client'),
      replay: {
        capturedAt: new Date().toISOString(),
        version: '9.9.9',
        customLayers: [],
        roots: [{id: 7, tagName: 'my-widget', children: []}],
        details: [],
        events,
        hmrIncompatibilities: [],
      },
    });
    instance = initDevframe(definition, {
      base: '/__lit/',
      distDir: false,
      ws: false,
      sse: false,
      getStorageDir: () => `${TMP}/storage`,
    });
    const ctx = await instance.context;
    await instance.ready;
    await ctx.rpc.invokeLocal('lit:export-snapshot', {outDir: out});

    // Plain static files, as someone would host the export.
    const root = joinPath(process.cwd(), out);
    server = createHttpServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
        .replace(/^\/__lit/, '')
        .replace(/\/$/, '/index.html');
      fsp
        .readFile(joinPath(root, path))
        .then((body: Buffer) => {
          res.setHeader(
            'content-type',
            path.endsWith('.js')
              ? 'text/javascript'
              : path.endsWith('.css')
                ? 'text/css'
                : path.endsWith('.json')
                  ? 'application/json'
                  : 'text/html'
          );
          res.end(body);
        })
        .catch(() => {
          res.statusCode = 404;
          res.end();
        });
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const port = (server.address() as {port: number}).port;

    const executablePath = process.env['HMR_E2E_EXECUTABLE'];
    browser = await chromium.launch({
      ...(executablePath !== undefined && executablePath !== ''
        ? {executablePath}
        : {channel: 'chrome'}),
      headless: process.env['HMR_E2E_HEADED'] === undefined,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // Ids read from the baked session, not invented: this is the export
    // round trip keeping them.
    const target = events[100]!.id;
    await page.goto(
      `http://127.0.0.1:${port}/__lit/#tab=timeline&event=${target}`
    );
    const selected = page.locator('timeline-event-list .row.selected');
    await selected.waitFor();
    expect(await selected.count()).toBe(1);
    // Event 100 is the start of span 50, at 500ms.
    expect(await selected.textContent()).toContain('500.0ms');
    expect(await selected.textContent()).toContain('performUpdate');

    const box = (await selected.boundingBox())!;
    const list = (await page
      .locator('timeline-event-list .scroll')
      .boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(list.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(list.y + list.height + 1);
    expect(await page.evaluate(() => location.hash)).toContain(
      `event=${target}`
    );
    expect(errors).toEqual([]);
  });
});
