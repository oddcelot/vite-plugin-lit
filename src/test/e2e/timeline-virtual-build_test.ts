/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {build} from 'vite';
import {afterAll, expect, test} from 'vite-plus/test';
import {litPlugin} from '../../index.js';
import {fsp, joinPath, tmpRoot} from './utils.js';

/**
 * `virtual:lit-plugin/timeline` is documented as safe to leave in a production
 * build. It wasn't: both hooks lived on the HMR plugin (`apply: 'serve'`), so
 * `vite build` skipped them and the bundler failed on an unresolved import
 * naming a module the developer never wrote. These are `vite build` runs, so
 * they fail on the regression rather than on an assertion.
 */

const ENTRY =
  `import {addTimelineEvent, addTimelineLayer} from 'virtual:lit-plugin/timeline';\n` +
  `addTimelineLayer({id: 'custom', label: 'Custom', color: 0xff0000});\n` +
  `export const emit = () => addTimelineEvent({layerId: 'custom', time: 0, data: {}});\n`;

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(
    roots.map((root) => fsp.rm(root, {recursive: true, force: true}))
  );
});

/** Builds a lib-mode fixture importing the virtual module; returns its chunk. */
const buildFixture = async (timeline: boolean): Promise<string> => {
  const root = tmpRoot('timeline-vmod');
  roots.push(root);
  await fsp.mkdir(root, {recursive: true});
  await fsp.writeFile(joinPath(root, 'package.json'), '{"type": "module"}\n');
  await fsp.writeFile(joinPath(root, 'entry.js'), ENTRY);

  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [litPlugin({timeline})],
    build: {
      minify: false,
      lib: {entry: 'entry.js', formats: ['es'], fileName: 'lib'},
    },
  });

  const dist = joinPath(root, 'dist');
  const emitted = await fsp.readdir(dist);
  const chunkName = emitted.find((f) => /\.m?js$/.test(f));
  if (chunkName === undefined) {
    throw new Error(`no JS chunk emitted: ${emitted.join(', ')}`);
  }
  return await fsp.readFile(joinPath(dist, chunkName), 'utf8');
};

test('builds with the timeline enabled, emitting the no-op stub', async () => {
  const chunk = await buildFixture(true);
  // The entry survives, so this is a real chunk and not a vacuous pass.
  expect(chunk).toContain('emit');
  // The stub replaces the runtime, so none of the transport lands in the
  // bundle — no HMR channel exists to drain its queue in production.
  expect(chunk).not.toContain('lit:timeline:custom-layer');
  expect(chunk).not.toContain('queueMicrotask');
  expect(chunk).not.toContain('public-api');
});

test('builds with the timeline disabled', async () => {
  const chunk = await buildFixture(false);
  expect(chunk).toContain('emit');
  expect(chunk).not.toContain('lit:timeline:custom-layer');
  expect(chunk).not.toContain('public-api');
});
