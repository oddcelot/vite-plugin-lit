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
`lit_get-meta`, `lit_hmr-incompatibilities`, `lit_set-recording` — so an agent
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

The CLI also has `lit-devtools dev`, a standalone devframe server with no page
attached. It exists to prove the panel definition runs without Vite (a
framework-neutrality harness, and the groundwork for non-Vite adapters); it
cannot show a real component tree, so it is not a way to inspect an app
without a dev server.

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

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
