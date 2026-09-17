# @oddsquad/vite-plugin-lit

A Vite plugin for Lit projects with true HMR, CSS delivery helpers for shadow
roots, and a DevTools timeline.

**[Documentation →](https://oddcelot.github.io/vite-plugin-lit/)**

Based on `@lit-labs/vite-plugin-lit` (formerly `@lit-labs/vite-hmr`) from the
[lit monorepo](https://github.com/lit/lit), which is kept checked out as a
read-only [submodule](./lit) here for reference and opt-in canary testing
against lit `main`.

## Why

lit-html decides "is this the same template?" by **object identity** of the
`TemplateStringsArray`, not by content. Vite HMR re-executes an edited module,
so a one-character edit rebuilds the component's entire subtree and takes
focus, scroll, input state, and child `@state` with it.

This plugin fixes that with two cooperating mechanisms:

1. **Template-strings interning** — the `html`/`svg`/`mathml`/`css` tags are
   wrapped in dev so strings arrays are canonicalized by content, and only the
   edited template rebuilds its part of the DOM.
2. **In-place class patching** — the duplicate `customElements.define` from the
   re-executed module patches the originally-registered class in place, then
   restores reactive property values through the new accessors.

[How it works →](https://oddcelot.github.io/vite-plugin-lit/getting-started/how-it-works/)

## Usage

```ts
// vite.config.ts
import {defineConfig} from 'vite';
import {litPlugin} from '@oddsquad/vite-plugin-lit';

export default defineConfig({
  plugins: [litPlugin()],
});
```

The HMR feature only applies to the dev server (`apply: 'serve'`); production
builds are untouched. The CSS queries (`?hmr-url`, `?css-sheet`) and Lightning
CSS literal processing apply in both dev and build.

## Features

- **[HMR that keeps state](https://oddcelot.github.io/vite-plugin-lit/guides/hmr/)**
  — what survives an edit, and what falls back to a reload.
- **[Stylesheets at scale](https://oddcelot.github.io/vite-plugin-lit/guides/stylesheets/)**
  — one shared `CSSStyleSheet` for thousands of shadow roots, hot-swapped
  without re-rendering, from a bare `?css-sheet` import.
- **[DevTools timeline](https://oddcelot.github.io/vite-plugin-lit/guides/devtools-timeline/)**
  — a layered event recorder and live component inspector inside Vite DevTools.
- **[Source overlay](https://oddcelot.github.io/vite-plugin-lit/guides/source-overlay/)**
  — click any element in the page to open its source in your editor.
- **[Ecosystem support](https://oddcelot.github.io/vite-plugin-lit/guides/ecosystem/)**
  — signals, context, tasks, and the virtualizer across a patch.

Reference:
[options](https://oddcelot.github.io/vite-plugin-lit/reference/options/) ·
[environment variables](https://oddcelot.github.io/vite-plugin-lit/reference/environment-variables/) ·
[import queries](https://oddcelot.github.io/vite-plugin-lit/reference/import-queries/) ·
[runtime API](https://oddcelot.github.io/vite-plugin-lit/reference/runtime-api/) ·
[limitations](https://oddcelot.github.io/vite-plugin-lit/reference/limitations/) ·
[benchmarks](https://oddcelot.github.io/vite-plugin-lit/reference/benchmarks/)

## Playground

A manually inspectable fixture app (also the source for the e2e fixtures), and
self-contained enough to open on
[StackBlitz](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/playground)
straight from the repo URL. Run it locally from the repo root:

```sh
pnpm dev   # builds the plugin, then serves http://localhost:5179
```

## Development

Requires Node 26 and pnpm 12 (`corepack enable` picks up the pinned version).

```sh
pnpm install         # workspace: root package + playground + docs
pnpm build           # tsc + panel assets -> ./lib, ./panel, ./index.js
pnpm exec vp check   # format, lint, type check
pnpm test            # unit + e2e
pnpm docs:dev        # the documentation site
```

More in
[Development](https://oddcelot.github.io/vite-plugin-lit/contributing/development/)
and [Testing](https://oddcelot.github.io/vite-plugin-lit/contributing/testing/).

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
