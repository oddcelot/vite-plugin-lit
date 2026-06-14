# @lit-labs/vite-plugin-lit

A Vite plugin for Lit projects with HMR, CSS helpers, and Lightning CSS support.

> [!WARNING]
>
> This package is part of [Lit Labs](https://lit.dev/docs/libraries/labs/).
> It is published in order to get feedback on the design and may receive
> breaking changes or stop being supported.

## Why

lit-html decides "is this the same template?" by **object identity** of the
`TemplateStringsArray`, not by content. Vite HMR re-executes an edited
module, so every `` html`...` `` produces a fresh strings array and lit
rebuilds the component's **entire** subtree for a one-character edit: focus,
scroll, and input state are lost, child `@state` resets, and cached DOM
references are orphaned.

This plugin fixes that with two cooperating mechanisms:

1. **Template-strings interning** — the `html`/`svg`/`mathml`/`css` tags are
   wrapped in dev so strings arrays are canonicalized by content. Unchanged
   templates keep their identity across re-execution, so only the **edited**
   template rebuilds its part of the DOM. Sibling templates, child
   components, focus, selection, and constructed stylesheets all survive.
2. **In-place class patching** — a `customElements.define` interceptor
   catches the duplicate define from the re-executed module and patches the
   originally-registered class in place: prototype and static descriptors
   are copied over, reactive property values are snapshotted and restored
   through the new accessors, styles are re-adopted, and live instances
   re-render once.

## Usage

```ts
// vite.config.ts
import {defineConfig} from 'vite';
import {litPlugin} from '@lit-labs/vite-plugin-lit';

export default defineConfig({
  plugins: [litPlugin()],
});
```

The HMR feature only applies to the dev server (`apply: 'serve'`); production
builds are untouched. The CSS queries (`?hmr-url`, `?css-sheet`) and Lightning
CSS literal processing apply in both dev and build.

## Options

`litPlugin()` takes a single options object. `hmr` groups the HMR feature and
its on-page indicator; `sourceOverlay` is the click-to-open-in-IDE inspector.

| Option                | Type                              | Default    | Description                                                                                                                        |
| --------------------- | --------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `hmr`                 | `boolean \| HmrOptions`           | `true`     | HMR for Lit components and its feedback. `false` disables patching **and** the indicator.                                          |
| `hmr.enabled`         | `boolean`                         | `true`     | Enable in-place HMR for Lit component classes.                                                                                     |
| `hmr.reconnect`       | `boolean`                         | `false`    | Cycle `disconnectedCallback()`/`connectedCallback()` on live instances after a hot patch. Interning makes this mostly unnecessary. |
| `hmr.onIncompatible`  | `'reload' \| 'warn'`              | `'reload'` | What to do when a component can't be hot-patched in place: reload the page, or only warn in the console.                           |
| `hmr.indicator`       | `boolean \| {enabled?, count?}`   | `true`     | On-page pulsing indicator that animates on each HMR update. Forced off when HMR is disabled.                                       |
| `hmr.indicator.count` | `boolean`                         | `false`    | Show a cumulative update count in the indicator.                                                                                   |
| `sourceOverlay`       | `boolean \| SourceOverlayOptions` | `false`    | Dev-only click-to-open-in-IDE inspector. Toggle with Ctrl+Shift+S (configurable via `key`).                                        |

### Environment variables

Every option also resolves from environment variables (and `.env` files) with
the `LIT_PLUGIN` prefix, read at config time. Options passed to `litPlugin()`
take precedence over env vars, which take precedence over the defaults.

| Env var                                 | Maps to                    |
| --------------------------------------- | -------------------------- |
| `LIT_PLUGIN_HMR`                        | `hmr.enabled`              |
| `LIT_PLUGIN_HMR_RECONNECT`              | `hmr.reconnect`            |
| `LIT_PLUGIN_HMR_ON_INCOMPATIBLE`        | `hmr.onIncompatible`       |
| `LIT_PLUGIN_HMR_INDICATOR`              | `hmr.indicator.enabled`    |
| `LIT_PLUGIN_HMR_INDICATOR_COUNT`        | `hmr.indicator.count`      |
| `LIT_PLUGIN_SOURCE_OVERLAY`             | `sourceOverlay` (enable)   |
| `LIT_PLUGIN_SOURCE_OVERLAY_KEY`         | `sourceOverlay.key`        |
| `LIT_PLUGIN_SOURCE_OVERLAY_EDITOR`      | `sourceOverlay.editor`     |
| `LIT_PLUGIN_SOURCE_OVERLAY_THROTTLE_MS` | `sourceOverlay.throttleMs` |

## Stylesheets

CSS in shadow roots can be delivered a few ways, with different HMR
behaviors. The plugin ships helpers under `@lit-labs/vite-plugin-lit/css.js`.
For choosing between them at scale — e.g. a large utility sheet (Tailwind,
UnoCSS) shared across many components — see
[`docs/css-delivery.md`](./docs/css-delivery.md), with a reproducible
benchmark in [`bench/`](./bench/README.md).

### Shared adopted stylesheet from a `.css` asset

`urlSheet()` builds a single constructed `CSSStyleSheet` from a `?url`-imported
CSS file, shareable across any number of components via `adoptedStyleSheets`.
An edit re-fetches and `replaceSync()`s the sheet in place — every adopter
updates **without re-rendering a component and without a full-page reload**.
The CSS stays a standalone, pipeline-processed `.css` file in the build output
(it isn't inlined into the JS bundle); the only cost is a brief flash of
unstyled content on initial load while the first fetch resolves.

```ts
// utility-sheet.ts
import {urlSheet} from '@lit-labs/vite-plugin-lit/css.js';
import sheetUrl from './utility-sheet.css?url';

const {sheet, onHotUpdate} = urlSheet(sheetUrl);
export default sheet;

// The accept must live here with the same literal specifier as the import —
// Vite resolves accepted HMR deps by static analysis, so it can't be hidden
// inside the helper.
import.meta.hot?.accept('./utility-sheet.css?url', onHotUpdate);
```

```ts
// any component
import sheet from './utility-sheet.js';

@customElement('my-el')
export class MyEl extends LitElement {
  static override styles = [sheet];
}
```

### Shared adopted stylesheet with no boilerplate (`?css-sheet`)

The `import.meta.hot.accept` line above is irreducible in a **runtime** helper —
Vite resolves accepted HMR deps by static analysis, so the literal specifier
has to appear in the importing module. The plugin sidesteps that by generating
the wiring for you: `import sheet from './x.css?css-sheet'` returns the same
hot-swapping, shareable `CSSStyleSheet` as `urlSheet()`, but the `urlSheet()`
call and the `accept` registration live in a plugin-generated virtual module,
so your code is a bare import.

```ts
// any component — no helper import, no import.meta.hot
import sheet from './utility-sheet.css?css-sheet';

@customElement('my-el')
export class MyEl extends LitElement {
  static override styles = [sheet];
}
```

Every module that imports the same `./x.css?css-sheet` shares one
`CSSStyleSheet` instance, so an edit updates all adopters in place. Add the
ambient type via `/// <reference types="@lit-labs/vite-plugin-lit/client" />`
(or the `types` tsconfig field) so the import resolves to `CSSStyleSheet`.

This targets utility-first CSS frameworks (Tailwind, UnoCSS): the framework
generates one complete `.css` file of utility classes, and every component
adopts it through a single shared sheet. In a `vite build` that file stays a
**standalone, content-hashed `.css` asset** — pipeline-processed (Lightning
CSS/PostCSS) and fetched once at runtime, never inlined into a JS chunk — so
the bundle keeps one cacheable stylesheet shared across the app. The `accept`
wiring is dev-only and is stripped from the build. (When the framework
regenerates the file in dev, the hot-swap relies on its Vite plugin emitting
an HMR update for the imported `.css` module — verify against your specific
Tailwind/UnoCSS integration.) Same FOUC caveat as `urlSheet()` (a runtime
fetch backs it); the tradeoff is control — reach for `urlSheet()` directly when
you need a custom fetch/transform, or when the importing code must run without
this plugin.

### External stylesheet via `<link>`

For a `<link rel="stylesheet">` (or `@import url()`) inside a shadow root, the
`?hmr-url` import query yields a real stylesheet URL (dev-served file; hashed
`.css` asset on build). On edit the component re-renders with a freshly
cache-busted href so the browser refetches — simpler than `urlSheet`, but it
**does** re-render. `devCacheBust()` is the underlying helper if you import
`?url` yourself.

### Inlined

`?inline` (processed) or `?raw` (verbatim) hand back the CSS as a string to
feed `unsafeCSS` or `replaceSync`. No standalone `.css` asset — the text ships
inside the JS chunk — but no runtime fetch and no FOUC.

## Signals

`@lit-labs/signals` is supported: its `html`/`svg` tags are interned just
like the core ones, the `SignalWatcher` mixin's regenerated class chain is
re-parented during a patch, and both per-instance signals and signals
imported from other modules keep their value and reactivity across an
update.

One caveat applies to all module-level state, not just signals: a
module-level `signal()` declared **inside an edited component module** is
re-created (with its initial value) when that module re-executes. Keep
shared signals in their own non-component module and import them — that
module never re-executes, so the signal object survives.

## Context

`@lit/context` is supported, including the experimental-decorator
`@provide`/`@consume` forms: those keep per-class-evaluation state (a
WeakMap of instance → controller populated via `addInitializer`), so during
a patch the runtime re-runs the class initializers for live instances to
enroll them in the new closures, then restores the provided value through
the new accessors — subscribed consumers keep both their value and a live
subscription. Controllers created by previous evaluations stay attached but
inert; that's bounded by edit count and cleared by any reload.

Define the context key in its own module (and prefer string keys —
`createContext('my-context')` is identity-by-value, a `Symbol()` key is
not), the same way you'd isolate any shared module-level state.

## Tasks

`@lit/task` works without special handling: the Task controller and its
completed value are instance state, which patches preserve. A hot patch
re-renders without re-fetching (the update re-evaluates `args()`, which are
shallow-equal, so the task stays `COMPLETE`), and args-driven re-runs keep
working afterwards. One caveat: the task _function_ is captured by the
controller at construction, so editing its body only affects future
instances — reload to swap fetch logic on live ones.

## Virtualizer

`@lit-labs/virtualizer` behaves well under patches: the
`<lit-virtualizer>` element holds its layout and scroll state, so as long
as it lives in its own template literal, header edits and even row-template
edits (the `renderItem` arrow is an interpolation _value_ — its body isn't
part of the outer literal's strings) preserve the element, the scroll
offset, and the visible window. Re-created `items` arrays with equal
content reflow without moving the scroller.

## Limitations

- **Standard `accessor` decorators**: reactive properties declared with
  standard (TC39) decorators close over per-class-evaluation private slots
  and cannot be patched in place. This is detected deterministically and
  falls back to a full reload (or a warning, per `onIncompatible`) — never a
  broken state. Experimental decorators (`@customElement`, `@property`,
  `@state` with `experimentalDecorators: true`) and `static properties` are
  fully supported.
- **Native `#private` fields**: methods copied from the new class that touch
  `#private` state will brand-check-throw on existing instances (this also
  triggers the reload fallback). Use TS `private` instead.
- **Mixed exports**: a module exporting a component _and_ other values
  self-accepts, so importers keep the previously-imported non-class bindings
  until they themselves re-execute. Class exports stay valid — the canonical
  class object is patched in place.
- **`observedAttributes` changes**: the platform snapshots them at define
  time; a console message recommends a reload when they change.
- **Interning map growth**: stale versions of edited templates accumulate in
  the (page-global) intern map over a dev session. This is bounded by the
  number of edits and cleared by any full reload.
- The Rolldown full-bundle dev mode is unsupported; the plugin targets the
  standard Vite dev server pipeline.

## Playground

A manually inspectable fixture app (also the source for the e2e
fixtures). The dev server runs in a WebContainer, so HMR works live in
the browser — no local checkout needed:

- [Open on StackBlitz](https://stackblitz.com/fork/github/oddcelot/lit/tree/feat/labs-vite-plugin-lit/packages/labs/vite-plugin-lit/playground?file=src%2Fhmr-counter.ts)
  (starts the dev server automatically)
- [Open on bolt.new](https://bolt.new/github.com/oddcelot/lit/tree/feat/labs-vite-plugin-lit/packages/labs/vite-plugin-lit/playground)
  (run `npm run dev` in the Bolt terminal — URL imports don't
  auto-start)

Or locally, inside the monorepo:

```sh
cd packages/labs/vite-plugin-lit
npm run dev   # http://localhost:5179
```

Edit the templates, styles, and labels in `playground/src/*.ts` and watch
counts, focus, and DOM identity survive. The page HUD counts HMR updates;
every component shows a `renders: n` badge.

Standalone runs use the interim npm publish of this plugin
(`@oddsquad/vite-plugin-lit`) on Vite 7 — Vite 8's rolldown wasm binding
currently crashes in WebContainers
([webcontainer-core#2104](https://github.com/stackblitz/webcontainer-core/issues/2104)).
Inside the monorepo the playground uses the local build on Vite 8.

## Tests

```sh
cd packages/labs/vite-plugin-lit
npm test            # unit + e2e
npm run test:unit   # node-only unit tests
npm run test:e2e    # spawns vite dev servers + system Chrome
```

The e2e suite drives the real dev server with playwright-core and the system
Chrome (`channel: 'chrome'`). Environment variables:

- `HMR_E2E_HEADED=1` — watch the browser while tests run.
- `HMR_E2E_EXECUTABLE=/path/to/chrome` — use a specific browser binary
  (e.g. after `npx playwright install chromium` if no system Chrome is
  available).

## Contributing

Please see [CONTRIBUTING.md](../../../CONTRIBUTING.md).
