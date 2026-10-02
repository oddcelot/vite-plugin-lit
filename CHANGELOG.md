# Changelog

Notable changes per release. Versions before 0.3.0 predate this file; see the
git history for those.

## 0.11.0 — 2026-10-02

A smaller release that makes the panel easier to read. The Components tab can
scroll the selected element into view, async failures now count in Updates,
every button has a tooltip, and Settings drops its row-by-row origin labels in
favour of showing the default where you choose a value. About also lists the
right Lit versions. Nothing needs action to upgrade.

### Added

- **Scroll a component into view from the Components tab.** A target button
  next to the selected element's tag scrolls it to the middle of the page and
  outlines it for a moment, so you no longer have to hunt for elements below
  the fold.
- **Async failures show up in Updates.** An async `updated()` whose promise
  rejects unhandled, or a `@lit/task` that fails, now marks the update that
  started it (_rejected in updated_, _task userTask failed_) and counts toward
  the component's ⚠, where before it left no trace in the panel.
- **Panel buttons explain themselves.** Hovering or tabbing to a button now
  shows a tooltip naming what it does, including the icon-only ones that
  previously had no hint at all.
- **Settings links to where the Chrome tracks show up.** The Chrome
  performance tracks row links to the timeline guide, which now shows the
  expanded Lit group in Chrome's Performance panel and how far to zoom to
  read it.

### Changed

- **Settings rows lose their "(default)" and "(overridden)" labels.** Only
  values set by an option or env var keep an origin badge, and an overridden
  row is marked by the highlighted value it replaced, such as `env: Zed`, and
  the × that resets it. Open a dropdown to see the default beside your value:
  with `LIT_PLUGIN_HMR_ON_INCOMPATIBLE=warn` the list reads `warn env` and
  `reload default`. Hover a setting's name for what it does.

### Fixed

- **About shows the right Lit versions.** Settings > About used to show
  lit-element's version labelled as "lit" (for example "lit 4.2.2" next to lit
  3.3.3). It now lists lit-html, lit-element and @lit/reactive-element by
  name, and the duplicate-copies warning says which package is duplicated.

## 0.10.0 — 2026-10-02

The DevTools panel has a new look built on Web Awesome, and it now follows one
tab at a time, so a second tab of the app no longer wipes the recording or
leaks into what you are looking at. Updates and the timeline show what changed
in a re-render and which updates threw, the Components tab stays live by
default and shows task, signal and controller state and the last HMR patch,
and agents can query by tag name. Nothing needs action to upgrade.

### Added

- **See what changed in a re-render.** Turn on the Changed values layer and
  each update records the old and new value of every changed property. The
  Updates tab lists them and flags a new reference that holds the same value,
  and `lit_update-summary` lists, per component, the properties reassigned to
  an equal new reference, so an agent can say which props re-render for
  nothing.
- **Errors thrown during an update are visible.** A phase that throws is
  marked in the timeline, counted per component in Updates, and reported
  through `lit_update-summary`, instead of looking like a normal update.
- **See tasks, signals and controllers in the Components tab.** The details
  pane now lists an element's `@lit/task` state, signals, reactive
  controllers and plain fields in an Instance table below its properties.
- **Pick a component library's elements, and step out to the one around.**
  Set `sourceOverlay.hosts` to `'lit'` and the picker also picks Lit elements
  you didn't write, such as `<wa-button>`, into the Components tab. While
  picking, ↑ and ↓ move the outline out to the enclosing element and back.
- **Agents can query by tag name and bound the tree.** `lit_recent-events`
  and `lit_component-details` accept `tagName`, the latter returning every
  matching element, so an agent no longer has to find an element id first.
  `lit_list-components` accepts `maxDepth`, and nodes it cuts off report how
  many children were left out.
- **See whether an HMR edit landed.** After an edit the Components tab reads
  which component was patched, how many instances it touched and how long it
  took. `lit_hmr-history` gives agents the recent patches with child-state
  mode, interleaved with the components that could not be patched.
- **The Components tab says why it is empty.** Instead of one generic line,
  it now tells you when the page runtime has not connected, when more than
  one copy of lit is loaded, or when the runtime is inside an iframe, with
  the next step for each.
- **Settings has an About section.** It shows the plugin version, the lit
  version the page loaded (and a warning for duplicate copies), the timeline
  layers, picker availability, and the order in which settings resolve.
- **The dev server tells you when the DevTools panel cannot mount.** With
  `timeline` on and `DevTools()` missing from `plugins`, the terminal now
  prints a one-time warning with the fix instead of staying silent.
- **Resize the component details pane.** Drag the divider between the
  component tree and the details; the width is remembered across reloads.

### Changed

- **The DevTools panel has a new look built on Web Awesome.** Buttons, tabs,
  switches, selects and badges are Web Awesome components with square
  corners and the Lit blue as the accent, and the text glyphs that stood in
  for icons, including the arrow between old and new values, are Phosphor
  icons now. The panel still works fully offline.
- **The Components tree follows the page by default.** **Live** starts on, so
  components that appear or go away show up without a click. Toggle it off
  to pause the tree; the Refresh button is gone, because turning Live back on
  brings the tree up to date.

### Fixed

- **A second tab no longer wipes the recording or leaks into the panel.** The
  session follows one page at a time, the one that loaded last, and a banner
  says when it switches. Events, picks, custom layers and HMR notices from
  any other tab are ignored, and the previous page's recording, component
  tree and HMR notices are cleared on a switch; reloading the same tab clears
  them without the banner.
- **`update` spans close for components that override `update()`.** A
  subclass calling `super.update()` no longer produces a nested duplicate
  bracket that left the outer span open and skewed Updates durations.
- **Agents see the live component tree.** `lit_list-components` and
  `lit_component-details` now ask the page instead of returning what the
  panel last fetched, so they work with no panel open.
- **Live mode follows the panel.** Closing the panel no longer leaves the
  page observing the DOM and rebuilding the tree, and after a panel or page
  reload the Live toggle no longer shows as on while the page has stopped
  pushing tree updates.
- **The active tab label no longer jumps up.** The selected panel tab now
  sits on the same baseline as the others instead of a couple of pixels
  higher.

## 0.9.0 — 2026-10-01

Pick now works on pages connected to the standalone `lit-devtools dev` server,
and `#private` state survives hot-patching on Vite 7 as it already did on Vite 8. One change needs action: runtime globals moved to the package's own
`Symbol.for` prefix. The rest are fixes to panel settings that didn't stick,
a Pick button with no picker behind it, and the HMR indicator sitting on the
DevTools toolbar.

### Added

- **Pick works on pages connected to `lit-devtools dev`.** Pick in the
  Components tab, or Ctrl/⌘+Shift+S on the page, picks any Lit element; the
  panel selects it and a panel tab comes forward on it. If you opened the
  panel yourself, the first pick opens a second panel tab and later picks
  reuse it.

### Changed

- **Runtime globals are keyed `@oddsquad/vite-plugin-lit#…`.** Code that read
  component source metadata (or any other plugin global) through
  `Symbol.for('@lit-labs/vite-plugin-lit#source')` needs the new prefix.

### Fixed

- **`#private` state survives HMR on Vite 7 too.** Editing a method that
  touches a private field of a decorated component no longer throws "Cannot
  read from private field" after esbuild has lowered it.
- **Panel settings survive a page reload in standalone mode and on
  StackBlitz.** After reloading the app, overrides such as flash updates or
  the HMR indicator reverted to the config defaults until a setting was
  changed again.
- **A setting changed right after opening the panel is kept.** The first
  toggle in a fresh panel session (for example Flash on the Components tab)
  could be silently wiped from the saved settings, so it was gone after a
  reload. Seen with `lit-devtools dev`; the Vite DevTools panel runs the same
  code.
- **The Components tab no longer shows a Pick button that does nothing.**
  Without the source overlay (off by default, and unavailable to pages
  connected to `lit-devtools dev`) the button lit up and no picker appeared.
  It now only appears when there is a picker to start.
- **The HMR indicator no longer covers the DevTools toolbar.** With the Vite
  DevTools dock on an edge, the indicator and the source-overlay tooltip sat
  on top of it instead of moving aside.
- **A `#event=` link scrolls to its row on a slow first load.** Opening the
  panel or a snapshot through a timeline link selected the event but could
  leave its row out of view when the list's layout code loaded slowly.

## 0.8.1 — 2026-10-01

A one-fix patch: turning the timeline on with `LIT_PLUGIN_TIMELINE=true` now
brings up the Lit DevTools panel, not just the page runtime behind it.

### Fixed

- **`LIT_PLUGIN_TIMELINE=true` brings up the Lit DevTools panel.** Turning the
  timeline on through the env var injected the page runtime but left the
  panel out of Vite DevTools; it now mounts as it does with `timeline: true`.

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
