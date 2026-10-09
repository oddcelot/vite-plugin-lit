# @oddsquad/vite-plugin-lit

[![CI](https://github.com/oddcelot/vite-plugin-lit/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/oddcelot/vite-plugin-lit/actions/workflows/ci.yaml?query=branch%3Amain)
[![npm](https://img.shields.io/npm/v/@oddsquad/vite-plugin-lit)](https://www.npmjs.com/package/@oddsquad/vite-plugin-lit)
[![JSR](https://jsr.io/badges/@oddsquad/vite-plugin-lit)](https://jsr.io/@oddsquad/vite-plugin-lit)
[![JSR score](https://jsr.io/badges/@oddsquad/vite-plugin-lit/score)](https://jsr.io/@oddsquad/vite-plugin-lit/score)
[![Mentioned in Awesome Lit](https://awesome.re/mentioned-badge.svg)](https://github.com/web-padawan/awesome-lit)
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/playground?startScript=stackblitz)

A Vite plugin for Lit projects with true HMR, CSS delivery helpers for shadow
roots, and a DevTools timeline.

https://github.com/user-attachments/assets/d396d3a8-ab26-46de-8c3f-71558db1a392

**[Documentation →](https://oddcelot.github.io/vite-plugin-lit/)**

Started life in a fork of the [lit monorepo](https://github.com/lit/lit) as a
proposed `@lit-labs/vite-hmr` package, and now lives here on its own. Lit is
kept checked out as a read-only [submodule](./lit) for reference and opt-in
canary testing against lit `main`.

## Try it

Each demo opens on StackBlitz and runs the latest release of the plugin in
your browser. The [Demos page](https://oddcelot.github.io/vite-plugin-lit/start/demos/)
embeds them, so you can try one without leaving the docs.

| Demo                                                                                               | What to try                                                                                                                         |                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Playground](https://github.com/oddcelot/vite-plugin-lit/tree/main/playground)                     | HMR and the Vite DevTools dock: click the counter, edit `src/hmr-counter.ts`, and the count stays.                                  | [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/playground?startScript=stackblitz)                   |
| [Standalone mode](https://github.com/oddcelot/vite-plugin-lit/tree/main/playground/standalone.mjs) | The same page as static files, without Vite, next to the DevTools panel on its own port.                                            | [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/playground?file=package.json&startScript=standalone) |
| [Lit flame](https://github.com/oddcelot/vite-plugin-lit/tree/main/examples/flame)                  | One component: turn its colours, stoke it and blow it out, then edit it and watch its state, `#private` field and colours survive.  | [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/examples/flame?file=src/lit-flame.ts)                |
| [Web Awesome](https://github.com/oddcelot/vite-plugin-lit/tree/main/examples/web-awesome)          | A component built from a third-party Lit library: edit it, and the library's elements keep their checked boxes and half-typed text. | [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/examples/web-awesome?file=src/packing-list.ts)       |
| [Fernhouse](https://github.com/oddcelot/vite-plugin-lit/tree/main/examples/fernhouse)              | A small shop to explore the DevTools on: pick a card, open its slots and parts in Anatomy, then record adding it to the cart.       | [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/examples/fernhouse?file=src/fh-product-card.ts)      |

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

[How it works →](https://oddcelot.github.io/vite-plugin-lit/concepts/how-hmr-works/)

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
- **[DevTools timeline](https://oddcelot.github.io/vite-plugin-lit/guides/devtools/)**
  — a layered event recorder and live component inspector inside Vite DevTools.
- **[Source overlay](https://oddcelot.github.io/vite-plugin-lit/guides/source-overlay/)**
  — click any element in the page to open its source in your editor.
- **[Agent access](#coding-agents-mcp)** — the same component tree and timeline
  as MCP tools, for coding agents.
- **[Ecosystem support](https://oddcelot.github.io/vite-plugin-lit/guides/ecosystem/)**
  — signals, context, tasks, and the virtualizer across a patch.

Reference:
[options](https://oddcelot.github.io/vite-plugin-lit/reference/options/) ·
[environment variables](https://oddcelot.github.io/vite-plugin-lit/reference/environment-variables/) ·
[import queries](https://oddcelot.github.io/vite-plugin-lit/reference/import-queries/) ·
[runtime API](https://oddcelot.github.io/vite-plugin-lit/reference/runtime-api/) ·
[CLI](https://oddcelot.github.io/vite-plugin-lit/reference/cli/) ·
[limitations](https://oddcelot.github.io/vite-plugin-lit/reference/limitations/) ·
[compatibility](https://oddcelot.github.io/vite-plugin-lit/reference/compatibility/) ·
[benchmarks](https://oddcelot.github.io/vite-plugin-lit/reference/benchmarks/) ·
[troubleshooting](https://oddcelot.github.io/vite-plugin-lit/guides/troubleshooting/)

## Coding agents (MCP)

The DevTools panel's data is also exposed as MCP tools — `lit_list-components`,
`lit_component-details`, `lit_update-summary`, `lit_recent-events`,
`lit_range-summary`, `lit_get-meta`, `lit_hmr-history`, `lit_hmr-incompatibilities`, `lit_set-recording` — so an agent
can read the live component tree and timeline instead of guessing from source.

These answer only while a Vite dev server with DevTools is **running**. There
is no stored data and nothing to go stale: with the server down an agent gets
a connection error, not an empty answer.

Point an MCP client at it either way:

```sh
# Auto-discovers every running dev server on this machine.
claude mcp add lit-devtools -- npx -y @oddsquad/vite-plugin-lit mcp

# Or dial one server directly, if you'd rather pin the port.
claude mcp add lit-devtools -- npx -y mcp-remote http://localhost:5179/__devtools/__mcp
```

The equivalent `claude_desktop_config.json` / `mcp.json` entry:

```json
{
  "mcpServers": {
    "lit-devtools": {
      "command": "npx",
      "args": ["-y", "@oddsquad/vite-plugin-lit", "mcp"]
    }
  }
}
```

The two differ in how the server is found, not in what it can do:

- **`... vite-plugin-lit mcp`** runs devframe's connector over stdio. The
  plugin publishes each running dev server to devframe's instance registry,
  and the connector lists them through two gateway tools
  (`devframe_connect_list-instances`, `devframe_connect_call-tool`) — so one
  entry covers every project you have running, with no port to keep in sync.
  Being a shared connector, it surfaces every devframe on the machine, not
  only this plugin's tools.
- **`mcp-remote <url>`** bridges stdio to one fixed URL and depends on no
  discovery at all. Reach for it if registry discovery is unavailable — the
  plugin logs a warning saying so at startup, naming the reason.

The CLI also has `lit-devtools dev`, a standalone devframe server. Started on
its own it shows an empty panel, because it has no page of its own. Add the
script tag it prints at startup to any page, including one that Vite does not
serve and one on another origin, and the page feeds it the live component tree,
inspector and timeline:

```html
<script src="http://localhost:5180/lit-devtools.js"></script>
```

Put it before the scripts that define your components. The server asks for its
one-time code unless you start it with `--no-auth`: type the code into the
prompt the page shows, open the page once with `#devframe_otp=<code>` on its
URL, or skip the gate on a loopback host with `--no-auth`. Pages on a loopback
origin (any port) may connect; for any other origin, pass it to the server with
`--allow-origin https://myapp.test:8443` (repeatable). A `*` in the host
matches any subdomain, e.g. `--allow-origin 'https://*.webcontainer-api.io'`
for StackBlitz, where every port gets its own origin.

Outside Vite the page has no build-time transforms, so HMR patching, source
locations and open-in-editor do not work there; the tree, inspector and timeline
do. A page that Vite serves can instead call `connectToDevServer()` from
`@oddsquad/vite-plugin-lit/connect.js`.

**Production builds.** The script tag also attaches to a minified build with
Lit's production condition, checked by
`src/test/e2e/standalone-production_test.ts`:

- Works: the component tree, the inspector (properties, controllers and
  `@lit/task` instances, even though Lit mangles its private controller set)
  and Record with the lifecycle layer (`performUpdate`, `willUpdate`,
  `update`, `updated`).
- Empty: the render layers, because Lit's production build never dispatches
  `lit-debug` events.
- Missing: source locations and open-in-editor (no build-time transform), HMR.
- Blocked: a page whose Content Security Policy does not allow the dev server's
  origin in `script-src` (for example `script-src 'self'`) refuses the tag, so
  nothing attaches.
- Cosmetic: names the minifier renamed show as it left them, so a plain
  controller's type reads as a short mangled identifier.

To try it from this repo, run `pnpm run standalone:demo`; see
[Playground](#playground).

## Playground

A manually inspectable fixture app (also the source for the e2e fixtures), and
self-contained enough to open on
[StackBlitz](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/playground?startScript=stackblitz)
straight from the repo URL. Run it locally from the repo root:

```sh
pnpm dev   # builds the plugin, then serves http://localhost:5179
```

The same playground runs in standalone mode, built to static files and fed to
a `lit-devtools dev` panel on another port: `pnpm run standalone:demo` here, or
[on StackBlitz](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/playground?file=package.json&startScript=standalone)
with `?startScript=standalone`. StackBlitz installs the published plugin, so
both links run the latest release of the plugin against the playground on `main`.

## Development

Requires Node 26 and pnpm 12 (`corepack enable` picks up the pinned version).
The published package itself runs on Node 20 or newer.

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
Issues and pull requests are welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

BSD-3-Clause. See [LICENSE](./LICENSE).

The DevTools bundle [Web Awesome](https://webawesome.com) components (MIT)
in the panel and [Phosphor](https://phosphoricons.com) icons (MIT) in the
panel and the in-page overlay.
