/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

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
import {fsp} from './utils.js';
import {initDevframe} from 'devframe/initiate';
import type {DevframeInstance} from 'devframe/initiate';
import {createLitDevframe} from '../../lib/devframe/definition.js';
import {createNullSource} from '../../lib/devframe/source.js';

let instance: DevframeInstance | undefined;

const TMP = './node_modules/.tmp-lit-snapshot-test';

afterEach(async () => {
  await instance?.close();
  instance = undefined;
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
});
