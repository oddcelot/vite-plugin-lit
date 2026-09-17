# Plan 09: Deep linking into the panel

## Status

- **Done** (2026-09-17)
- **Effort**: S
- **Risk**: LOW — additive; a panel with no link behaves exactly as before
- **Depends on**: 01 and 02 in the sense the roadmap meant (there has to be
  something worth linking to), plus 08 in practice: the most useful link turns
  out to point into an exported snapshot

## Two arrival paths

Devframe documents deep linking as two mechanisms, and the panel needs both
because it runs in two quite different places.

**Inside the hub.** Anything holding an RPC client calls
`hub:docks:activate` with `{dockId, params}`. `params` is an opaque bag the
target dock interprets. Crucially the hub does not only broadcast it live — it
mirrors the request into the `devframe:docks:active` shared state, so a panel
that mounts _because of_ the activation still converges on it rather than
missing the broadcast it was too late for. The panel subscribes to that slot
and reacts to activations naming its own dock.

**Standalone, or as an exported snapshot.** No hub, so the URL is the only
carrier. Devframe's guidance is to use the **hash**, not the query string,
because the query is where handshake tokens live and those must not travel in
a link someone pastes into an issue. `#tab=components&component=7`.

Both collapse to one `DeepLink` shape (`src/panel/deep-link.ts`), so the shell
handles a single case.

## What it does

- Applies `tab` and `componentId` from either source.
- Writes the panel's current position back to the hash with `replaceState`, so
  copying the address bar yields a working link. `replaceState`, not
  `pushState`: clicking through a tree is browsing one view, and a history
  entry per click would make Back useless. Only when the panel owns its URL —
  docked in the hub it is an iframe whose address nobody reads.
- Makes an overlay pick carry its target: `vite.ts` now activates the dock
  with `{componentId}` instead of the bare dock id, so the activation itself
  names the element rather than racing the separate `pick` message.

## One thing that bit

The hook runs in `firstUpdated()`, not `connectedCallback()`. The shell reaches
the Components view through a `@query`, which resolves against rendered DOM —
applied a frame earlier, a link naming a component silently dropped its
selection (and then the hash re-write helpfully removed the param, so the
evidence disappeared too). Caught because the verification asserted on the
resulting selection rather than on "the tab changed".

## Verified

- **Hash path, end to end in a browser**: exported a snapshot from the
  playground, served it as plain static files, and opened
  `#tab=components&component=0`. The panel opens the Components tab with
  `<hmr-counter>` selected, and the hash round-trips. This is the composition
  that makes the feature worth having — a link into a frozen session someone
  can send with a bug report.
- **Hub path**: `hub:docks:activate` with `{dockId: 'lit', params: {tab,
componentId}}` lands in `devframe:docks:active` as
  `{"activation":{"dockId":"lit","params":{...}}}` — exactly the shape the
  panel subscribes to.

## Deliberately not done

- **Linking to a timeline event.** The roadmap sketch lists "a timeline event
  by group id". Timeline events carry no stable identity across a reload — the
  buffer is positional — so a link to one would be valid only within the
  session that produced it, which is the one case where you do not need a link.
  A snapshot changes that (the events are frozen), so this is worth revisiting
  on top of 08, with an id that actually survives the export.
- **Linking from the HMR diagnostics.** The roadmap pairs this with 01. The
  diagnostics are terminal output; there is nothing to click. The panel's own
  incompatibility list could link, but it already sits next to the tree it
  would link into.
