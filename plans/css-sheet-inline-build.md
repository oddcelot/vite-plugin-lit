# `?css-sheet` build modes

`import sheet from './x.css?css-sheet'` compiles to a shared `CSSStyleSheet`. In
dev it is fetch-backed and hot-swaps in place. Under `vite build`, the
`cssSheetBuild` option (env `LIT_PLUGIN_CSS_SHEET_BUILD`) picks the form:
`'url'`, `'inline'`, `'inline-raw'` or `'auto'` (the default).

## Decisions

- **Library builds inline the css by default.** The fetch-backed form imports
  `<file>?url` and wraps it in `urlSheet()`. That is right for an app, which
  serves its own hashed `.css` assets. It is wrong for `build.lib`: consumers
  bundle the library's JS only, the emitted `.css` never reaches their build,
  and the runtime fetch 404s. `urlSheet()` swallows fetch failures, so the sheet
  stays silently empty. `'auto'` therefore resolves to `'inline'` when
  `build.lib` is set and to `'url'` otherwise. Dev ignores the option.
- **Two inline flavors.** `'inline'` imports `<file>?inline`, so the text goes
  through the css pipeline exactly as the `?url` asset would. It is the
  consistent default. `'inline-raw'` imports `?raw` and embeds the text
  verbatim. It exists for css the configured transformer rejects, for example
  Lightning CSS erroring on a spec-invalid `@property` with
  `initial-value: var(...)`.
- **A flat enum, not a nested `cssSheet: {...}` object.** It matches the env-var
  story. Nesting would only earn its keep with per-import config, which nobody
  has asked for.
- **Auto prefers `'inline'` over `'inline-raw'`.** Pipeline-consistent output
  beats byte-faithfulness; `'inline-raw'` stays an explicit opt-in.

## Invariants

- The inline form is a virtual module per resolved css file, so it builds one
  module-level sheet and every importer shares it, as in dev. No `.css` asset is
  emitted for an inlined import, because nothing references `?url` any more.
- The `\0` prefix and `.js` suffix on the virtual id keep Vite's css plugins
  from treating the wrapper as css. Do not drop the suffix.
- The inline form has no `import.meta.hot` block. It is build-only.
- The inline module builds the sheet at top level, so importing the built module
  needs constructable-stylesheet support (Safari 16.4 or later). jsdom and Node
  SSR throw at import. The url form has the same requirement through
  `urlSheet()`, just lazily.
- `litCssQueries()` takes the option as a getter, because `litPlugin()`
  re-resolves options against the loaded env in a `config` hook after the plugin
  array is built. Called standalone with no getter it behaves as `'auto'`, which
  the baseline e2e relies on.

## Source

`src/lib/plugins/css-queries.ts`, `src/lib/options.ts`,
`src/lib/runtime/css.ts`. Tests: `src/test/e2e/css-sheet-build_test.ts`,
`src/test/unit/options_test.ts`.
