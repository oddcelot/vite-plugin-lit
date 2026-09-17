# Plan 07: In-page channel for the hover outline

## Status

- **Done** (2026-09-17). Shipped narrower than the roadmap sketch: the hover
  outline moved, the picker did not. See "Scope, and what stayed" below.
- **Effort**: S (the sketch estimated M, which assumed pick moved too)
- **Risk**: LOW — additive, feature-detected, and the RPC route it bypasses is
  untouched and still the fallback
- **Depends on**: none
- **Unblocks**: 08 (a snapshot panel needs interactions that work with no node
  side at all)

## Why this matters

`plans/roadmap/README.md` argued two gains, and both survive contact:

- **Latency.** The outline fires on every `mouseenter` in the component tree.
  It went panel → node (RPC) → Vite HMR → page, a full round trip through the
  dev server to draw a box the page could draw itself.
- **Reach.** An in-page loop keeps working where there is no node side, which
  is the difference between a static snapshot that is interactive and one that
  is a screenshot.

## Scope, and what stayed

Moved:

- **Hover outline** (`highlight`). Pure page-local drawing, issued per pointer
  move, and nothing outside the page ever wants to know about it.

Deliberately not moved:

- **Tree and details.** The node side caches the last tree and the last details
  per element so a panel that connects late has something to render, and so the
  MCP tools can answer with no panel open. Moving these would mean either
  losing that cache or maintaining two copies of it.
- **The picker** (`pick`), despite the roadmap sketch listing it. The panel's
  Pick button is handled on the node side, which broadcasts the overlay toggle
  **and** brings the Lit dock to the front (`docks.activate` in
  `src/lib/devframe/vite.ts`). The dock is a hub concept; the page cannot
  activate it. Moving the toggle while leaving the activation behind would
  split one interaction across two transports for no gain.
- **`measure`.** The sketch lists it; nothing in the panel measures anything
  today. Left unbuilt rather than speculatively designed.

## How it fits together

- `src/types/in-page.ts` — the channel name and the `InPageChannelProtocol`
  contract, imported by both endpoints. One event: `highlight(id | null)`.
- `src/lib/runtime/inspector/highlight.ts` — the outline itself, extracted from
  `install.ts` so both transports drive the same box.
- `src/lib/runtime/inspector/install.ts` — creates the page-script endpoint
  **outside** the `import.meta.hot` gate, since not needing a dev server is the
  whole point. Clears the outline when a panel disconnects, so a panel that
  goes away mid-hover cannot leave a box painted over the app.
- `src/panel/in-page.ts` — the panel endpoint, connected lazily on first use
  rather than at panel boot: connecting posts handshake hellos to every
  ancestor window, and a user who never opens the Components tab has no reason
  to pay for that.
- `src/panel/components-view.ts` — `_highlight()` prefers the channel and falls
  back to RPC.

The fallback is not defensive padding. A panel opened as its own tab has no
page script in its ancestry and will never connect; so does a page served by a
version of this plugin that predates the channel.

## Verified

`src/test/e2e/in-page-channel_test.ts`, in a real browser with a real dev
server: a panel iframe handshakes with the page script, emits `highlight`, and
the outline appears **positioned over the element** (not merely present), then
disappears on `highlight(null)`. Asserting the geometry matters — an outline at
0×0 would satisfy a presence check.

Two things that test caught, both worth keeping in mind for 08:

- The bare `devframe/in-page-channel` import inside a `/@fs/`-served runtime
  module does resolve: Vite pre-bundles it into the app's optimised deps. That
  was the main integration risk and it is now covered by a test rather than an
  assumption.
- The injected runtime `src` carries a doubled slash (`/@fs//Users/...`) while
  Vite's own internal imports use a single one. The browser keys module records
  by URL string, so importing the doubled form executes a _second_ copy of the
  module with its own WeakMap. Only a hazard for test code reaching into
  runtime internals, but an expensive one to rediscover.

## Cost

The panel bundle grows ~31 kB raw / ~10 kB gzip. Acceptable for a dev-only
panel; worth re-checking if the channel ever gets used for one small thing more.
