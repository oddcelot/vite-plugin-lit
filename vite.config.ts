import {defineConfig} from 'vite-plus';

export default defineConfig({
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
        files: ['playground/**'],
        rules: {'typescript/unbound-method': 'off'},
      },
      {
        // `const {page, edit} = fixture` destructures arrow closures off the
        // object literal startFixture returns; none of them reference `this`.
        files: ['src/test/e2e/**'],
        rules: {'typescript/unbound-method': 'off'},
      },
    ],
    ignorePatterns: [
      'index.*',
      'lib/',
      'types/',
      'panel/',
      'node_modules/',
      '.e2e-tmp/',
      'lit/',
      'playground/dist/',
      'bench/results/',
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
      'node_modules/',
      '.e2e-tmp/',
      'lit/',
      'playground/dist/',
      'bench/results/',
    ],
  },
});
