/**
 * @license
 * Copyright 2026 Oddsquad
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Opt-in canary testing: with `LIT_CANARY=1`, bare `lit` / `@lit/*` /
// `@lit-labs/*` imports resolve into the checked-out lit submodule (built
// from real source) instead of the published npm versions. This lets the
// e2e suite run against lit `main` and makes the real lit source browsable
// at ./lit for reference.
import {existsSync} from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Alias} from 'vite';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const CANARY_ENABLED = process.env['LIT_CANARY'] === '1';

// Bare specifier -> package directory inside the lit submodule, plus the
// bare entry file. The lit family is aliased as a unit: `lit` re-exports from
// `lit-html`, `lit-element`, and `@lit/reactive-element`, so aliasing `lit`
// alone would mix lit `main` with the published copies of its parts.
//
// Every package but the virtualizer ships a `development/` build (the one
// with DEV_MODE on: `lit-debug` events, dev warnings) next to its production
// build at the package root, selected by the `development` export condition.
// An alias to a bare directory or a raw file path bypasses `exports`, so it
// lands on the production build and the dev-only behaviour the plugin relies
// on silently vanishes. `dev: true` entries are therefore pointed at
// `development/` explicitly.
const CANARY_PACKAGES = [
  {id: 'lit', dir: 'packages/lit', entry: 'index.js', dev: true},
  {id: 'lit-html', dir: 'packages/lit-html', entry: 'lit-html.js', dev: true},
  {
    id: 'lit-element',
    dir: 'packages/lit-element',
    entry: 'index.js',
    dev: true,
  },
  {
    id: '@lit/reactive-element',
    dir: 'packages/reactive-element',
    entry: 'reactive-element.js',
    dev: true,
  },
  {id: '@lit/context', dir: 'packages/context', entry: 'index.js', dev: true},
  {id: '@lit/task', dir: 'packages/task', entry: 'index.js', dev: true},
  {
    id: '@lit-labs/signals',
    dir: 'packages/labs/signals',
    entry: 'index.js',
    dev: true,
  },
  {
    id: '@lit-labs/virtualizer',
    dir: 'packages/labs/virtualizer',
    entry: 'lit-virtualizer.js',
    dev: false,
  },
] as const;

const LIT_DIR = path.join(REPO_ROOT, 'lit');

export interface CanarySettings {
  resolve?: {alias: Alias[]};
  optimizeDeps?: {exclude: string[]};
}

/**
 * Vite settings to spread into a server (or vitest) config. Returns `{}` when
 * canary mode is off, so default runs are untouched. Throws with a pointer to
 * `pnpm build:lit-canary` when the submodule is present but not built.
 */
export const canarySettings = (): CanarySettings => {
  if (!CANARY_ENABLED) {
    return {};
  }
  if (!existsSync(path.join(LIT_DIR, 'packages', 'lit', 'index.js'))) {
    throw new Error(
      'LIT_CANARY=1 but the lit submodule is not built — run: pnpm build:lit-canary'
    );
  }
  return {
    resolve: {
      alias: CANARY_PACKAGES.flatMap(({id, dir, entry, dev}) => {
        const root = path.join(LIT_DIR, dir, dev ? 'development' : '');
        const escaped = id.replace(/[\\^$.*+?()[\]{}|]/g, String.raw`\$&`);
        return [
          {
            find: new RegExp(`^${escaped}$`),
            replacement: path.join(root, entry),
          },
          {find: new RegExp(`^${escaped}/(.*)$`), replacement: `${root}/$1`},
        ];
      }),
    },
    // Without this the dep optimizer pre-bundles a second copy of each
    // package from node_modules alongside the aliased one — two module
    // instances, which breaks identity-sensitive HMR state tests.
    optimizeDeps: {exclude: CANARY_PACKAGES.map(({id}) => id)},
  };
};
