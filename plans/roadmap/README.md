# Devframe roadmap

What the devframe migration (`plans/devframe-foundation.md`, phases 1–2, commits
`f7e21ed` and `2889243`) makes possible, ordered by **DX impact** — how much
each one changes the day-to-day experience of a developer using this plugin.

These live in `plans/roadmap/` rather than `advisor-plans/` because they are
forward-looking feature design, not audit findings. They supersede the
"Phases 3–4" sketch in `plans/devframe-foundation.md` and two entries in
`advisor-plans/README.md`'s "Direction" list (noted per plan).

## Ranking

| Rank | Plan | Title                                          | DX impact | Effort | Depends on | Status |
| ---- | ---- | ---------------------------------------------- | --------- | ------ | ---------- | ------ |
| 1    | 01   | Surface HMR-incompatibility reasons            | HIGH      | M      | —          | DONE   |
| 2    | 02   | Give coding agents the timeline                | HIGH      | S      | —          | DONE   |
| 3    | 03   | CLI + stdio MCP against the running dev server | HIGH      | M      | 02         | DONE   |
| 4    | 04   | Type the public timeline API                   | MED       | S      | —          | DONE   |
| 5    | 06   | Persist panel settings per project             | MED       | S      | —          | DONE   |
| 6    | 07   | In-page channel for the hover outline          | MED       | S      | —          | DONE   |
| 7    | 08   | Static snapshot for bug reports                | MED       | M      | 02, 07     | DONE   |
| 8    | 05   | Open-in-editor via `@devframes/service-open`   | LOW       | S      | —          | DONE   |
| 9    | 09   | Deep linking into the panel                    | LOW       | S      | 08         | DONE   |
| 10   | 10   | Nuxt and Next adapters                         | LOW       | M      | 03         | TODO   |

Plan numbers are stable file IDs, not ranks — 05 was demoted after its plan was
written (see below). Read the table top to bottom for the ordering.

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) |
REJECTED (one-line rationale).

Plans 01–09 have their own files. 10 is recorded below with enough detail
to pick up later; writing them out now would mean inventing design detail ahead
of the need.

## Why this order

The ranking is by impact on a **Lit developer using the plugin**, not by how
interesting the work is or how much new surface it adds.

- **01 first because it fixes the product's worst moment.** The plugin's whole
  promise is "HMR that keeps state." When a component cannot be patched in
  place, the page full-reloads, state is lost, and the developer is given a
  console line they were not looking at. The reasons are already computed
  exactly (`src/lib/runtime/patch.ts`); they are simply not shown. This is the
  only item that improves the experience of every user on every failure, and it
  converts the most confusing behavior into the most legible one.
- **02 next because it is the largest capability gain per unit of work.** Agents
  can already read the component tree and one element's state. They cannot see
  the timeline — which is the plugin's differentiator and the actual evidence
  for "why did this re-render?". The transport already exists; this is a query
  RPC and a bounded buffer.
- **03 because it is how agents actually attach.** The hub already serves an
  MCP endpoint at `/__devtools/__mcp` while a Vite dev server with DevTools is
  running — verified by hand against the playground, where `lit_get-meta`,
  `lit_list-components`, and `lit_component-details` all answer with live data
  over HTTP with an `Origin` header. What is missing is a stdio path, which is
  how editors and desktop agents are normally configured. Plan 03's first step
  is documentation only and ships immediately; the rest is making discovery
  work without hand-written config. Ranked below 02 because it is delivery
  plumbing for a capability that has to exist first.
- **04 and 06 are small, well-understood, and remove daily friction.** 04 was a
  documented feature that did not typecheck; it has shipped. 06 stopped
  settings from being per-browser; it has shipped too, as per-developer
  (devframe's `global` settings scope), not per-project — see the plan's
  status block for why `project` turned out to be the wrong scope _and_ the
  wrong storage dir from what its own research assumed.
- **07 and 08 mostly mattered once the tool was used outside a live dev
  server**, which is why they sat below the items that improve it inside one.
  Both have shipped; 08 leans on 07 exactly as predicted, since a frozen panel
  whose hover outline needed a server would be a screenshot with buttons.
- **05 was demoted while its plan was being written.** The original reasoning
  here — "drops a dependency and hardens a filesystem path" — was wrong. The
  source overlay runs in the inspected page with no devframe client, over a
  plain `fetch` (`src/lib/runtime/source-overlay/overlay-element.ts:197`), and
  it has to keep working with `timeline: false`, which is the documented way to
  enable it. The devframe is only mounted when `timeline: true`
  (`src/lib/plugin.ts:903`). So `/__lit-open-in-editor`, `launch-editor`, and
  `src/lib/http.ts` all stay, and the change shrinks to two panel-only callers
  gaining path containment. Still worth doing, no longer worth doing early.
  Shipped smaller again: the plan assumed the plugin would install
  `@devframes/service-open` and hand it extra roots, but the Vite DevTools hub
  already installs it (via `@devframes/plugin-messages`) before its services
  barrier, so a second install only earns a DF0066 warning on every dev-server
  start and its options are discarded. The panel therefore consumes the
  service and installs nothing.
- **09 was a convenience, and 10 expands the audience** rather than deepening
  the experience — and this plugin's users are on Vite by definition. 09 has
  shipped; 10 is the only item left, and still gated on wanting the inspector
  without the HMR patching that is this package's reason to exist.

Effort/impact outlier worth noting: **04 had the best ratio on the board** (an
ambient declaration versus a documented API that failed to compile), and it has
shipped, and 06 has followed it.

## Not yet planned

### 07 — In-page channel for the hover outline

Shipped; see `plans/roadmap/07-in-page-channel.md`. Narrower than this sketch
was: the hover outline moved to devframe's in-page channel, the picker did not.
The panel's Pick button also brings the Lit dock to the front, and a dock is a
hub concept the page cannot reach — splitting that one interaction across two
transports would have bought nothing. `measure` was never built, so there was
nothing to move.

### 08 — Static snapshot for bug reports

Shipped; see `plans/roadmap/08-static-snapshot.md`. The sketch's framing held
up exactly: the valuable artefact is a recorded session, not a static copy of
the panel, and that is what decided where the export runs. A fresh CLI process
has no session to freeze, so the dev server exports its own state and
`lit-devtools build` now says so instead of claiming to be unimplemented.

### 09 — Deep linking into the panel

Shipped; see `plans/roadmap/09-deep-linking.md`. The sketch's sequencing note
("only pays off once there is something worth linking to") turned out to point
at 08 rather than at 01/02: the link that earns its keep is one into an
exported snapshot, which someone can actually send. Linking to a timeline event
was left out — events have no identity that survives a reload — and is worth
revisiting now that a snapshot freezes them.

### 10 — Nuxt and Next adapters

`@devframes/nuxt` and `@devframes/next` mount a devframe into those frameworks.
The definition is already framework-neutral — that property is the whole point
of `src/lib/devframe/definition.ts` having no Vite import — so the adapter work
is genuinely small.

The honest caveat: this package is a **Vite** plugin for Lit. A Nuxt or Next app
using Lit components would get the panel, but not the HMR patching that is the
package's reason to exist, because that rides on Vite's module graph. Worth
doing only if there is demand for the inspector on its own, and it would need a
clear statement of what does and does not work. Sequenced after 03, which
establishes that the definition really does run outside Vite.

## Rejected

- **A JSON-render UI for the panel.** Devframe's
  [JSON-render](https://devfra.me/guide/json-render) lets a devframe ship
  UI-as-data instead of a built SPA. The panel is already a Lit app with a
  design system (`src/lib/tokens.ts`, `src/panel/`), and its value is in
  domain-specific views — a timeline scrubber and a component tree — not in
  generic forms. Rewriting it as serializable specs would cost the design system
  and buy nothing this tool needs.
- **Exposing the mutating RPCs to agents.** `set-recording`, `toggle-layer`,
  `inspect`, and `set-settings-override` deliberately carry no `agent` field, so
  devframe's default-deny keeps them out of MCP. An agent that can silently
  start a recording or retarget the picker changes the developer's tool state
  underneath them. Plan 02 revisits exactly one narrow case (recording) and has
  to argue it explicitly.
- **Cross-devframe services.** Publishing Lit component data as a
  `ctx.services` capability for other devframes to consume is architecturally
  tidy and has no consumer. Revisit if a second devframe in this workspace ever
  wants it.
