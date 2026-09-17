/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {existsSync, readdirSync} from 'node:fs';
import {afterAll, beforeAll, expect, test} from 'vite-plus/test';
import type {Plugin} from 'vite';
import type {DevframeDefinition} from 'devframe';
import {litPlugin} from '../../index.js';
import {type Fixture, startFixture} from './utils.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture({plugin: {timeline: true}});
});

afterAll(async () => {
  await fixture?.close();
});

/** Finds the devframe plugin `createLitDevframePlugin()` contributes. */
const findDevframePlugin = (plugins: Plugin[]): Plugin | undefined =>
  plugins.find((p) => p.name === 'devframe:lit');

test('timeline runtime script is injected into served HTML', async () => {
  const {page} = fixture;
  const srcs = await page.evaluate(() =>
    Array.from(document.scripts).map((s) => s.src)
  );
  expect(
    srcs.some((s) => s.includes('timeline') && s.includes('install'))
  ).toBe(true);
});

test('inspector runtime script is injected into served HTML', async () => {
  const {page} = fixture;
  const srcs = await page.evaluate(() =>
    Array.from(document.scripts).map((s) => s.src)
  );
  expect(
    srcs.some((s) => s.includes('inspector') && s.includes('install'))
  ).toBe(true);
});

test('litPlugin({timeline: true}) contributes a DevTools hook', () => {
  const plugin = findDevframePlugin(litPlugin({timeline: true}));
  expect(plugin).toBeDefined();
  expect(plugin?.devtools?.capabilities?.dev).toBe(true);
  expect(plugin?.devtools?.capabilities?.build).toBe(false);
  expect(typeof plugin?.devtools?.setup).toBe('function');
});

test('litPlugin({}) (timeline off) contributes no DevTools hook', () => {
  expect(findDevframePlugin(litPlugin({}))).toBeUndefined();
});

test('devtools.setup() installs the devframe definition', async () => {
  // Built fresh rather than reusing the fixture's instance, so the fake hub
  // context below is the only thing that ever calls this plugin's setup.
  const plugin = findDevframePlugin(
    litPlugin({timeline: true, sourceOverlay: true})
  );
  expect(plugin).toBeDefined();

  const installed: DevframeDefinition[] = [];
  const commands: Record<string, unknown>[] = [];
  await plugin!.devtools!.setup({
    viteServer: fixture.server,
    install: async (d: DevframeDefinition) => {
      installed.push(d);
    },
    commands: {
      register: (c: Record<string, unknown>) => {
        commands.push(c);
        return {};
      },
    },
  } as never);

  expect(installed).toHaveLength(1);
  const definition = installed[0]!;
  expect(definition.id).toBe('lit');
  expect(definition.name).toBe('Lit');
  expect(definition.packageName).toBe('@oddsquad/vite-plugin-lit');

  expect(typeof definition.clientAssets).toBe('string');
  const clientAssets = definition.clientAssets as string;
  expect(existsSync(clientAssets)).toBe(true);
  expect(readdirSync(clientAssets)).toContain('index.html');

  expect(commands.some((c) => c['id'] === 'lit:overlay:toggle')).toBe(true);
});
