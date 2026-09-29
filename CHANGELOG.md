# Changelog

Notable changes per release. Versions before 0.3.0 predate this file; see the
git history for those.

## 0.8.0 — 2026-09-30

The plugin is now on JSR as well as npm: every release publishes the same
build to jsr.io/@oddsquad/vite-plugin-lit. The documentation site gets a page
per release, the StackBlitz playground starts again, and the licence now names
oddcelot as the copyright holder.

### Added

- **Also on JSR.** Releases now publish to jsr.io/@oddsquad/vite-plugin-lit
  alongside npm, so `npx jsr add @oddsquad/vite-plugin-lit` installs the same
  build.
- **The docs have a page per release.** The changelog on the documentation
  site now lists every version with its date and links to a page for each
  one, plus a page with everything that changed since a given version.

### Changed

- **The licence names the right copyright holder.** The package's LICENSE,
  author field and source headers credited Google LLC; they now credit
  oddcelot. The licence terms (BSD-3-Clause) are unchanged.

### Fixed

- **The StackBlitz playground starts.** Opening the playground on StackBlitz,
  in dev or with `npm run standalone`, no longer stops at "Cannot find native
  binding", and the dev server prints where to open the Lit DevTools panel in
  its own tab.

## 0.7.0 — 2026-09-29

Hot-patching covers two cases it used to get wrong: components with native
`#private` members, which threw, and child elements whose parent template you
edit, which lost their state. The standalone `lit-devtools dev` server also
gets pages to feed it: one script tag connects any page running Lit, whether
Vite serves it or not, directly or through a proxy. Two fixes ride along:
open-in-editor links lose a stray slash, and the timeline no longer misses the
first component's connect and disconnect.

### Added

- **Components with `#private` fields keep hot-patching.** Editing an element
  that uses native `#private` fields or methods now updates it in place and
  keeps its private state, instead of throwing "Cannot read private member".
  Set `hmr.privateFields: false` to keep real brand checks in dev.
- **Child components keep their state when you edit the parent.** Changing the
  template a child element sits in no longer resets its `@state` and
  `#private` fields; `hmr.childState: 'reuse'` keeps the original element
  where it has no bindings, and `'reset'` restores the old behaviour. The
  DevTools Settings tab can switch the mode live; the next edit uses it.
- **Pages outside Vite can feed the standalone panel.** `lit-devtools dev` now
  prints a `<script src=".../lit-devtools.js">` tag; a page that loads it shows
  its component tree, inspector and timeline in the panel, even when Vite
  doesn't serve it or it's reached through a proxy or tunnel. Pages on
  localhost connect on any port, and `--allow-origin` admits others, with `*`
  for any subdomain (`--allow-origin 'https://*.webcontainer-api.io'` for
  StackBlitz). HMR, source locations and open-in-editor still need Vite.

### Fixed

- **Open-in-editor links use the documented URL form.** Links to VS Code,
  Cursor, Zed and Windsurf no longer carry a double slash before absolute
  paths like `/Users/...`.
- **The timeline records the first component's connect and disconnect.** On a
  page with no Lit element when the DevTools runtime starts, the first
  component defined afterwards now shows its `connectedCallback` and
  `disconnectedCallback` events like the rest.

## 0.6.1 — 2026-09-29

A fix release. Components whose `extends` clause holds braces load in dev
again, and the plugin now shares one devframe with the current Vite DevTools.
The rest comes from a security pass over the dev server: source opens and
snapshot exports stay inside the project, and the standalone server won't go
without its code gate on a network address.

### Changed

- **`lit-devtools dev --no-auth` only runs on localhost.** Combined with a
  `--host` other machines can reach, it now refuses to start instead of
  letting anyone on the network drive the panel without a code.

### Fixed

- **Components whose `extends` clause has braces load in dev again.** With
  `sourceOverlay` on, a class like `extends Dialog<{open: boolean}>` or
  `extends Mixin(Base, {shadow: true})` broke the module with a 500 from the
  dev server. Broken since 0.3.0.
- **Exporting a snapshot can no longer delete your files.** The export wipes
  its output directory before writing, and nothing checked which directory
  that was. It now only writes inside the dev server's working directory and
  only replaces an earlier snapshot.
- **The panel can only open source files inside your project.** Source links
  from the DevTools panel used to open any absolute path they were given. They
  now follow the same rule as the in-page overlay: the path has to be under
  the Vite root or `server.fs.allow`.
- **Symlinks can't send the editor outside your project.** Opening a source
  file used to follow a symlink under the project to wherever it pointed. Now
  the target has to be inside the project too.
- **One copy of devframe alongside the current Vite DevTools.** The plugin
  pinned devframe 1.0.0 exactly, so apps on `@vitejs/devtools-kit` 0.7.6
  installed a second copy and got an unmet-peer warning. It now accepts any
  devframe 1.x.

## 0.6.0 — 2026-09-29

A small release with one feature. The Lit timeline can now appear in Chrome
DevTools' own Performance panel, so an update tick sits on the same time axis
as the layout, paint and long tasks it caused.

### Added

- **Lit updates in Chrome's Performance panel.** Turn on **chrome performance
  tracks** under Timeline in the Settings tab and a Chrome Performance
  recording gets a Lit track group, with each update tick nested as
  `<my-element> performUpdate` over its phases, next to layout, paint and
  long tasks. It works without the Lit panel recording, and traces taken
  through chrome-devtools-mcp include it.

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
