# `?css-sheet` — inline mode for library builds

Today `?css-sheet` emits the same fetch-backed form in dev and build: a
virtual module importing `<file>?url` and wrapping it in `urlSheet()`. That
is correct for apps (they serve their own hashed `.css` assets) but broken
for `build.lib`: consumers bundle the library's **JS** only, the emitted
`.css` assets never reach their build, and the runtime fetch 404s — the
sheet stays silently empty. Downstream (`pentacode/packages/ui/vite.config.ts`,
`inlineCssSheets()`) works around this with a local `enforce: 'pre'` plugin
that claims the query first and inlines the css text. This plan moves that
behavior into the plugin so the override (and its copied-regex drift risk)
can be deleted.

## API

New option on `LitPluginOptions`, resolved like the others (explicit >
env > default; env prefix `LIT_PLUGIN`):

```ts
/**
 * What a `?css-sheet` import compiles to under `vite build`.
 * - 'url':        fetch-backed sheet over the emitted `.css` asset (today's behavior)
 * - 'inline':     css text embedded in the JS chunk, processed by the css pipeline (`?inline`)
 * - 'inline-raw': css text embedded verbatim, skipping the css pipeline (`?raw`)
 * - 'auto':       'inline' when `build.lib` is set, 'url' otherwise
 * Dev is always the fetch-backed HMR form regardless of this setting.
 * Defaults to 'auto'.
 */
cssSheetBuild?: 'auto' | 'url' | 'inline' | 'inline-raw';
```

Env var: `LIT_PLUGIN_CSS_SHEET_BUILD`.

Why two inline flavors: `?inline` matches the url form (the `?url` asset is
pipeline-processed too), so it's the consistent default. `?raw` exists for
css the configured transformer rejects — e.g. Lightning CSS errors on the
spec-invalid `@property` + `initial-value: var(…)` some downstream component
css carries. Verbatim css is what that downstream shipped historically.

## Implementation — all in `src/lib/plugin.ts`

| Where                                  | Change                                                                                                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LitPluginOptions`                     | Add `cssSheetBuild` (jsdoc as above).                                                                                                                                                                                                                      |
| `ResolvedOptions` + `resolveOptions()` | Add `cssSheetBuild`, parse `LIT_PLUGIN_CSS_SHEET_BUILD`, validate enum, default `'auto'`.                                                                                                                                                                  |
| `litCssQueries()`                      | Accept an optional getter `(() => ResolvedCssSheetBuild)` so the standalone export (baseline e2e) keeps working with the `'url'` default. Add a `configResolved` hook capturing `config.command === 'build'` and `!!config.build.lib` to resolve `'auto'`. |
| `load()`, css-sheet branch             | When building and the resolved mode is an inline flavor, emit the inline template below instead of the `urlSheet()` form. Url form and `?hmr-url` branch unchanged.                                                                                        |
| `litPlugin()` assembly                 | Pass the getter into `litCssQueries(...)` (same deferred-`resolved` pattern as `litTimelinePlugin`).                                                                                                                                                       |

Inline template (`<q>` = `?inline` or `?raw` per mode):

```js
import css from '<file><q>';
const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
export default sheet;
```

No `import.meta.hot` block — build only. Return `{code, moduleType: 'js'}`
like the existing branches.

Properties that must hold (they fall out of the existing virtual-module
design — listed so tests pin them):

- **Sheet identity is shared.** One virtual module per resolved css file →
  one module-level sheet; every importer gets the same object, matching dev
  semantics.
- **No `.css` asset is emitted** for inlined imports (nothing references
  `?url` anymore).
- The existing `\0` prefix + `.js` suffix already keep Vite's css plugins
  off the virtual module; nothing new needed in `resolveId`.

Known limitation to document, not solve: the inline form constructs the
sheet at module top level, so importing the built module requires
constructable-stylesheet support (browsers ≥ Safari 16.4; jsdom/node SSR
will throw at import). The url form has the same requirement via
`urlSheet()`, just lazier.

## Tests

| Test                                                              | Proves                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/test/e2e/css-sheet-build_test.ts` (new)                      | Lib-mode fixture build with default `'auto'`: output chunk contains the css text and `replaceSync`, emits no `.css` asset for the import; loading the built module in the page yields `instanceof CSSStyleSheet` with the expected rule; two importers share one sheet object. |
| Same file, second build with `cssSheetBuild: 'url'`               | Opt-out restores today's asset-emitting form.                                                                                                                                                                                                                                  |
| Same file, `'inline-raw'` fixture whose css Lightning CSS rejects | Raw flavor builds verbatim where `'inline'` would fail.                                                                                                                                                                                                                        |
| Unit (`resolveOptions`)                                           | Env var `LIT_PLUGIN_CSS_SHEET_BUILD` parses, explicit option wins, invalid value falls back/warns.                                                                                                                                                                             |
| Existing `css-sheet-query_test.ts`, `baseline-no-plugin_test.ts`  | Unchanged — dev/HMR behavior and standalone `litCssQueries()` default are untouched.                                                                                                                                                                                           |

## Docs

README `?css-sheet` section: behavior table (dev → fetch + HMR; app build →
fetch over emitted asset; lib build → inline by default), the option, its
env var, and the `'inline-raw'` escape hatch with the Lightning CSS
`@property` example.

## Downstream cleanup (pentacode, after release)

- Bump `@oddsquad/vite-plugin-lit`.
- Delete `inlineCssSheets()` from `packages/ui/vite.config.ts`; set
  `litPlugin({cssSheetBuild: 'inline-raw'})` (verbatim css — see above), or
  try `'auto'`/`'inline'` and keep `'inline-raw'` only if the pipeline still
  rejects the `@property` rules.
- `vitest.config.ts` and app configs unchanged.

## Open questions

- Flat enum (`cssSheetBuild`) vs nested object (`cssSheet: {build, source}`)
  — flat matches the env-var story best; nested leaves room for future
  per-import config. Plan assumes flat.
- Should `'auto'` prefer `'inline'` (pipeline-consistent) as written, or
  `'inline-raw'` (byte-faithful to source)? Plan assumes `'inline'`.
