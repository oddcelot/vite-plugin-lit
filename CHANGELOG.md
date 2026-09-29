# Changelog

Notable changes per release. Versions before 0.3.0 predate this file; see the
git history for those.

## 0.4.0 — 2026-09-29

A maintenance release. The timeline panel stays fast with a full buffer, the
live inspector stops walking the whole page, and several failures that used to
pass silently now say so. Releases are published from CI now.

### Added

- **Verbose render layer.** lit-html's per-part debug events (template
  instantiation, `set part`, each binding commit) go to a new "Lit Render
  (verbose)" layer. It is off by default, because it fires once per binding on
  every render. Values are summarized as strings (`string:"…"`, `node:<li>`,
  `template`, `function:onClick`) and never passed through.
- **Releases from a version tag.** Pushing a `v*` tag runs the CI gate, checks
  the tag against `package.json` and `CHANGELOG.md`, publishes to npm over
  trusted publishing (OIDC), and creates the GitHub Release from the changelog
  section. Prereleases go to the `next` dist-tag.

### Changed

- **The timeline list renders only the visible rows**, through
  `@lit-labs/virtualizer`. A 2500-event recording keeps about 75 rows in the
  DOM instead of one per event. Filtering reruns only when the events or
  filters change.
- **Live inspector mode no longer re-walks the page on every mutation.**
  Batches with no custom element or shadow root in them are dropped, and
  relevant batches walk only the subtrees they added.
- **The docs site was rewritten** in plain language, with a tutorial, task-sized
  DevTools guides, a troubleshooting page, screenshots in both themes, and the
  Lit Design System's colours and type.

### Fixed

- The source overlay's default hotkey is Ctrl+Shift+S, as documented. The
  runtime used to fall back to `e`, which also collided with the DevTools pick
  command.
- The source overlay removes its HMR listeners when it disconnects. Moving the
  element used to register the toggle twice, so the Vite DevTools overlay
  command did nothing, and a removed overlay kept reacting.
- `urlSheet()` and `?css-sheet` warn when a stylesheet fails to load, and treat
  non-ok responses as failures. A 404 used to hand Vite's fallback page to the
  sheet as CSS, with a clean console. The sheet keeps its last good CSS.
- An unknown `LIT_PLUGIN_HMR_ON_INCOMPATIBLE` value logs a warning and falls
  back to the default, instead of quietly acting as `reload`.
- The Lightning CSS pass over `css` literals finds them by parsing the module,
  so `css`-tagged text inside a string, a comment, or another template literal
  is no longer rewritten.

## 0.3.0 — 2026-09-17

The DevTools half of the plugin was rebuilt on
[devframe](https://www.npmjs.com/package/devframe), and most of what follows
falls out of that: the panel is no longer tied to Vite DevTools, and the same
data it shows is reachable by a coding agent over MCP.

### Added

- **The panel runs on devframe.** The bespoke transport is gone. The panel
  works docked in Vite DevTools, in its own tab, or standalone from the CLI.
- **`lit-devtools` CLI.** `lit-devtools dev` serves the panel without a Vite
  dev server of its own; `lit-devtools mcp` exposes the panel's data to an MCP
  client over stdio, discovering a running dev server on its own.
- **MCP tools for agents** — list the component tree, read recent timeline
  events, start and stop a recording, and read why a module fell back to a full
  reload instead of a hot patch.
- **Updates tab.** The timeline reads as an explainer for a single update:
  what changed, which components re-rendered, and what it cost.
- **Session export.** A recorded session can be written out as a static copy of
  the panel — shareable, no dev server needed to open it.
- **Deep links.** Panel views are addressable, so a link opens the tab, the
  selected element, or an exported snapshot at the right place.
- **Flash on update.** An opt-in fading outline over every element that
  finishes an update, with an optional ramp colouring it by updates per second.
- **Ambient types for `virtual:lit-plugin/timeline`**, shipped in
  `@oddsquad/vite-plugin-lit/client` alongside the CSS query declarations.
  Following the custom-layers guide no longer means silencing `TS2307`.
- **Documentation site** at <https://oddcelot.github.io/vite-plugin-lit/>, and
  a CI workflow that type checks, lints, tests and builds every push.

### Changed

- Panel settings persist per developer through devframe's settings store
  instead of per browser, so they follow you across browsers and survive
  clearing site data. `localStorage` stays as the page's boot-time cache.
- Source links open through the shared open-in-editor service and resolve
  against the Vite root.
- The docked panel draws its hover outline over a direct page channel rather
  than routing through the dev server.
- Tooling moved to Vite+ (oxfmt, oxlint, tsgolint); dependencies updated to
  TypeScript 7, Vite 8.3, es-module-lexer 3 and magic-string 1.
- The README is a front door now; the long-form guides live on the docs site.

### Fixed

- **`virtual:lit-plugin/timeline` broke `vite build`.** Both hooks lived on the
  serve-only plugin, so nothing claimed the specifier during a build and the
  bundler failed on a module the developer never wrote. It now resolves in dev
  and build alike, stubbing itself out in any build.
- The dev-server endpoints reject cross-site requests.
- Source metadata is injected in the component class's own scope, so it can no
  longer reference a class that isn't in scope.
- The DevTools element watch survives a hot patch; `updated()` is resolved
  lazily rather than captured once.
- Recording state is synced to a page runtime when it connects, so a reload
  mid-recording keeps recording.
- `recent-events` works when called with no arguments, and the documented MCP
  endpoint path matches the one the server serves.
