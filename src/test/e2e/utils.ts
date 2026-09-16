/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {randomUUID} from 'node:crypto';
import {cp, readFile, rm, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer, type ViteDevServer} from 'vite';
import {chromium, type Browser, type Page} from 'playwright-core';
import {litPlugin, type LitPluginOptions} from '../../index.js';
import {litCssQueries} from '../../lib/plugin.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PLAYGROUND_DIR = path.join(PACKAGE_ROOT, 'playground');

export interface Fixture {
  server: ViteDevServer;
  browser: Browser;
  page: Page;
  root: string;
  /**
   * Edits a fixture file relative to the served root and lets the dev
   * server pick it up. Throws on no-op transforms so a green test can't be
   * silently vacuous.
   */
  edit(rel: string, transform: (code: string) => string): Promise<void>;
  close(): Promise<void>;
}

export interface StartFixtureOptions {
  /** `false` disables the plugin entirely (baseline runs). */
  plugin?: false | LitPluginOptions;
}

export const startFixture = async (
  options: StartFixtureOptions = {}
): Promise<Fixture> => {
  // Copy inside the package — bare imports resolve by walking up to the
  // repo-root node_modules; the OS tmpdir would break that.
  const root = path.join(
    PACKAGE_ROOT,
    '.e2e-tmp',
    `pg-${randomUUID().slice(0, 8)}`
  );
  // The e2e server uses inline config; the manifest files exist only for
  // standalone (StackBlitz/bolt.new) runs and would skew dep resolution.
  const FIXTURE_EXCLUDE = new Set([
    'package.json',
    'package-lock.json',
    '.npmrc',
    'node_modules',
  ]);
  await cp(PLAYGROUND_DIR, root, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      // Drop the vite config (inline config below) and any `.env*` files so a
      // developer's local playground env can't perturb deterministic e2e runs.
      return (
        !base.startsWith('vite.config') &&
        !base.startsWith('.env') &&
        !FIXTURE_EXCLUDE.has(base)
      );
    },
  });
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: {host: '127.0.0.1', port: 0},
    // Baseline runs keep the CSS import-query plugin (the playground source
    // can't boot without it) but drop the HMR plugin — the query provides no
    // HMR boundaries, so the baseline's full-reload claim is unaffected.
    plugins:
      options.plugin === false
        ? [litCssQueries()]
        : [litPlugin(options.plugin ?? {})],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('dev server has no address');
  }
  const url = `http://127.0.0.1:${address.port}/`;

  const executablePath = process.env['HMR_E2E_EXECUTABLE'];
  const browser = await chromium.launch({
    ...(executablePath !== undefined && executablePath !== ''
      ? {executablePath}
      : {channel: 'chrome'}),
    headless: process.env['HMR_E2E_HEADED'] === undefined,
  });
  const page = await browser.newPage();
  const ready = () =>
    page.waitForFunction(
      () => (window as {__hmr?: unknown}).__hmr !== undefined
    );
  await page.goto(url);
  await ready();
  // Defensive: if the dep optimizer discovered anything on first load, its
  // full-reload has settled by now; a clean reload makes test state
  // (clicks, focus) immune to it.
  await page.reload();
  await ready();

  return {
    server,
    browser,
    page,
    root,
    edit: async (rel, transform) => {
      const file = path.join(root, rel);
      const code = await readFile(file, 'utf8');
      const next = transform(code);
      if (next === code) {
        throw new Error(`edit produced no change: ${rel}`);
      }
      await writeFile(file, next);
    },
    close: async () => {
      await browser.close();
      await server.close();
      await rm(root, {recursive: true, force: true});
    },
  };
};

// Selector paths are `>>`-separated, hopping into a shadow root at each
// step (e.g. `'hmr-parent >> hmr-child >> #badge'`). Each `page.evaluate`
// embeds the same tiny resolver loop — evaluate callbacks are serialized,
// so they can't share a closure.

/** Pins a node's identity in `window.__hmr.keep` for later comparison. */
export const keepShadow = (
  page: Page,
  key: string,
  path: string
): Promise<void> =>
  page.evaluate(
    ([key, path]) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      if (node === null) {
        throw new Error(`keepShadow: no node for ${path}`);
      }
      (
        window as unknown as {__hmr: {keep: Map<string, unknown>}}
      ).__hmr.keep.set(key, node);
    },
    [key, path] as const
  );

/** The pinned node is still the one in the live DOM. */
export const sameAsKept = (
  page: Page,
  key: string,
  path: string
): Promise<boolean> =>
  page.evaluate(
    ([key, path]) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      const kept = (
        window as unknown as {__hmr: {keep: Map<string, unknown>}}
      ).__hmr.keep.get(key);
      return (
        kept !== undefined && node !== null && kept === node && node.isConnected
      );
    },
    [key, path] as const
  );

/** Trimmed text content of the node at a selector path (null if absent). */
export const shadowText = (page: Page, path: string): Promise<string | null> =>
  page
    .evaluate((path) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      return node?.textContent?.trim() ?? null;
    }, path)
    .catch(() => null);

export const dataRenders = (page: Page, path: string): Promise<string | null> =>
  page
    .evaluate((path) => {
      const parts = path.split('>>').map((p) => p.trim());
      let node: Element | null = document.querySelector(parts[0]);
      for (const part of parts.slice(1)) {
        node = node?.shadowRoot?.querySelector(part) ?? null;
      }
      return node?.getAttribute('data-renders') ?? null;
    }, path)
    .catch(() => null);

export const hmrUpdates = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as {__hmr: {updates: number}}).__hmr.updates
  );
