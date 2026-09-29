# Changelog

Notable changes per release. Versions before 0.3.0 predate this file; see the
git history for those.

## 0.5.0 — 2026-09-29

The timeline gets a second view: Tracks, one lane per layer on a shared time
axis. The Settings tab now says where each value came from and flags overrides
the config has since moved past. Timeline events can be linked to, a reloaded
panel keeps what was recorded, and both the panel and the in-page overlay open
source links in the editor you picked.

### Added

- **Tracks view for the timeline.** A List | Tracks switch in the Timeline
  toolbar draws the recording as one horizontal lane per layer on a shared time
  axis, so concurrency, gaps and rhythm are visible: which layers fire
  together, how a click lines up with the update it caused. Overlapping spans
  stack, so an update tick reads as `performUpdate` with its phases beneath it,
  and marks never get narrower than 2px. Wheel zooms around the pointer, drag
  pans, double-click fits the whole recording, and a fitted view follows the
  live edge while recording. A chip strip picks which lanes to draw; it is a
  view filter, not the capture toggle. Both views share one selection and one
  detail pane.
- **Where each setting came from.** Settings rows read like "Zed (env)",
  "VS Code (default)" or "Cursor (option)". An overridden row names the
  baseline it replaced and has its own reset. An unknown
  `LIT_PLUGIN_SOURCE_OVERLAY_EDITOR` value now logs a warning and falls back to
  the default.
- **A hint when the config moved under an override.** An override remembers
  the value it was made against. If that config value has since changed, the
  row says "Config changed since you overrode this: was X, now Y", with Reset
  (let the new config apply) and Keep (hide the hint, keep the override).
- **Links to timeline events.** Selecting a row puts `#event=<id>` in the
  hash; opening that link selects the span and scrolls it into view, in a live
  session or an exported snapshot. An id the buffer no longer holds opens the
  Timeline with nothing selected.
- **Temporal values in the inspector** preview as their kind plus ISO form,
  e.g. `Temporal.PlainDate(2026-09-29)`, instead of an empty object. This works
  with native Temporal and with polyfills.
- **The standalone `lit-devtools dev` server can be fed from a live page.** A
  page calls `connectToDevServer()` (from `@oddsquad/vite-plugin-lit/connect.js`)
  to send its tree, inspector and timeline traffic to the server's panel over
  devframe RPC. `lit-devtools dev --no-auth` skips the one-time code. Pages not
  served by Vite, and cross-origin pages, are not covered yet.

### Changed

- **The timeline's element and regex filters apply to Tracks too**, so
  switching views mid-investigation no longer brings back everything you
  filtered out. A filter that hides the selected mark keeps its detail pane
  open, as the List always did.

### Fixed

- **A reloaded live panel keeps the recorded events.** Reloading or first
  opening the panel mid-session used to show "No events recorded." while the
  dev server still held them, and a cold `#event=` link could not resolve. The
  panel now fills itself from the server's buffer when it connects, without
  duplicates, and events you cleared stay cleared across a reload.
- **Source links open in the editor you chose.** The editor picked through
  `sourceOverlay.editor`, `LIT_PLUGIN_SOURCE_OVERLAY_EDITOR` or the Settings
  tab only shaped the overlay's URL scheme; clicks from the panel and the
  in-page overlay let launch-editor guess, so picking Cursor could open VS
  Code. Both now pass the chosen editor (`vscode`, `cursor`, `zed`, `idea`).
  Windsurf, custom editors and projects that never named one still
  auto-detect.
- **Exported snapshots contain the whole event buffer**, not the last 50
  events, so every row in an export can be linked to.
- **A linked timeline row scrolls into view on a cold open** instead of
  leaving the list pinned to its newest row.
- **The panel has a favicon**, so opening it in its own tab no longer logs a
  404 for `/favicon.ico`.

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
