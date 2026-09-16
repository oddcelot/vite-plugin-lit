import {defineConfig} from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  lint: {
    jsPlugins: [{name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin'}],
    rules: {'vite-plus/prefer-vite-plus-imports': 'error'},
    options: {typeAware: true, typeCheck: true},
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
