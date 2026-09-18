/**
 * @license
 * Copyright 2026 Oddsquad
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {defineConfig} from 'vite-plus';
import {canarySettings} from './src/test/canary.js';

export default defineConfig({
  // Empty unless LIT_CANARY=1 (see src/test/canary.ts).
  ...canarySettings(),
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/test/unit/**/*_test.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['src/test/e2e/**/*_test.ts'],
          // Each e2e file owns a vite dev server + browser; keep them
          // sequential to avoid port/file contention and CPU thrash.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
  staged: {
    '*': 'vp check --fix',
  },
  lint: {
    jsPlugins: [{name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin'}],
    rules: {'vite-plus/prefer-vite-plus-imports': 'error'},
    options: {typeAware: true, typeCheck: true},
    overrides: [
      {
        // Lit invokes template event listeners with `this` set to the host,
        // so `@click=${this.foo}` is the idiomatic binding, not a bug.
        files: ['playground/**', 'src/panel/**'],
        rules: {'typescript/unbound-method': 'off'},
      },
      {
        // `const {page, edit} = fixture` destructures arrow closures off the
        // object literal startFixture returns; none of them reference `this`.
        files: ['src/test/e2e/**'],
        rules: {'typescript/unbound-method': 'off'},
      },
    ],
    // Leading slashes matter: unanchored `lib/` and `panel/` would also
    // match src/lib and src/panel, which are source, not build output.
    ignorePatterns: [
      '/index.*',
      '/lib/',
      '/types/',
      '/panel/',
      '/lit/',
      'node_modules/',
      '.e2e-tmp/',
      'playground/dist/',
      'bench/results/',
      'docs/dist/',
      'docs/.astro/',
      // Finished files from the docs tutorial. They are a plain-Vite user's
      // project, not this package: `import {defineConfig} from 'vite'` is the
      // point, and the ambient types resolve only once the plugin is
      // installed from npm. Verified by hand per examples/tutorial/README.md.
      '/examples/',
      // Generated from the root CHANGELOG.md on every docs build.
      'docs/src/content/docs/reference/changelog.md',
    ],
  },
  fmt: {
    singleQuote: true,
    bracketSpacing: false,
    trailingComma: 'es5',
    printWidth: 80,
    sortPackageJson: false,
    // Build output (index.*, lib/, types/, panel/) is covered by .gitignore.
    // Listing it here too would also exclude it from the explicit
    // `vp fmt --ignore-path /dev/null` step in the build script.
    ignorePatterns: [
      'pnpm-lock.yaml',
      '/lit/',
      'node_modules/',
      '.e2e-tmp/',
      'playground/dist/',
      'bench/results/',
      'docs/dist/',
      'docs/.astro/',
      'docs/src/content/docs/reference/changelog.md',
    ],
  },
});
