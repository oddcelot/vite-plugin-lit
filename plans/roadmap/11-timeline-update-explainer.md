# Plan 11: Turn the timeline into an update explainer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**:
> `git diff --stat a01c411..HEAD -- src/panel src/lib/devframe src/lib/runtime/timeline src/types/timeline.ts docs/src/content/docs/guides/devtools-timeline src/test/unit/devframe_test.ts src/test/e2e/lifecycle-timeline_test.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Implemented** (2026-09-17) on `roadmap/11-timeline-update-explainer`. All
  eight steps shipped. Three deviations from the plan as written, all
  deliberate:
  1. Step 5's `attributeInput` shipped **with step 1** rather than after step 4
     — it belongs in `derive.ts` next to the functions it composes, and
     splitting it out would have meant editing the module twice for nothing.
     Its UI (the cause column) and its tests still landed as step 5 describes.
  2. Step 0's rising-edge clear went in the **`session.on('updated')`
     listener**, not the `set-recording` handler. The file already documents
     that listener as the single push point for recording changes, and the
     panel can mutate the shared state directly without going through the
     action — clearing in the handler alone would have missed that path.
  3. Step 4 replaced the repeated `'timeline' | 'components' | 'settings'`
     union with a `DEEP_LINK_TABS` const in `deep-link.ts`. The plan called for
     editing all four copies; one list that the two parsers validate against is
     the same change without the fourth copy.
- **Priority**: P1 — the timeline is the feature `README.md` sells as the
  plugin's differentiator, and it renders as a generic chronological log. The
  data that makes it Lit-specific is captured and then discarded at render
  time. Two behaviours the docs describe do not exist.
- **Effort**: M–L. Eight steps, sequenced so steps 0–2 are shippable on their
  own and deliver most of the visible win.
- **Risk**: MED. Step 0 changes buffer semantics (an existing unit test
  asserts buffer clearing). Steps 2–4 touch the panel's hottest render path
  and add a tab, which means touching the deep-link union in four places.
- **Depends on**: none. Builds on 02 (the `recent-events` ring buffer) and 08
  (snapshot replay), both shipped.
- **Category**: dx / product (plus one documented-but-absent feature, and one
  latent correctness bug)
- **Planned at**: commit `a01c411`, 2026-09-17

## Why this matters

The capture layers already record everything needed to answer the two
questions a Lit developer actually has — _why did this component re-render_
and _which component re-renders too much_:

- `groupId` pairs every lifecycle phase's start with its end, and the whole
  update tick shares one id: `` groupId = `${elementId}:${tick}` ``
  (`src/lib/runtime/timeline/lifecycle.ts:90-98`).
- `data.changed` carries the changed reactive-property key names — the "why"
  — extracted from the `PropertyValues` map
  (`src/lib/runtime/timeline/identity.ts:91-99`, emitted at `lifecycle.ts:100`).
- Element identity is stable across HMR patches
  (`src/lib/runtime/timeline/identity.ts:52-62`) and carries a source
  file/line deep-link (`identity.ts:78-86`).

The panel reads none of it. A repo-wide grep for `groupId` under `src/panel/`
returns **zero hits**; `data.changed` reaches the UI only inside the
`JSON.stringify(ev.data)` blob of the detail pane
(`src/panel/timeline-event-list.ts:424`). The list renders one row per raw
event, so a single update tick of one component is five to ten rows and the
developer subtracts timestamps by hand.

This is the same class of defect as Plan 04 — a documented feature that does
not work — and the documentation is already ahead of the code. The layer
table at `docs/src/content/docs/guides/devtools-timeline/index.mdx:48` reads:

> | Lit Lifecycle | `connectedCallback`, `performUpdate`, `willUpdate`, `update`, `updated`, `firstUpdated`, `disconnectedCallback` — **with per-phase duration bars and changed-property keys** |

Neither the duration bars nor the changed-property keys exist in the panel.
The original design intended them: `plans/devtools-timeline.md` says `groupId`
exists "so the panel can render duration bars."

The second-order point: as a chronological log the timeline competes with the
Chrome Performance panel and loses. As an update explainer it has no
competitor, because nothing else knows what a Lit reactive property is.

## Current state

### What the panel does with events today

`src/panel/timeline-view.ts` owns the buffer and hands it down raw:

- Live: subscribes to the `lit:timeline` stream and appends batches, capped by
  a tail slice — `MAX_EVENTS = 5000` (`timeline-view.ts:29`, appended at
  `:187-189`).
- Snapshot: one-shot `rpc.call('recent-events', {})`, no subscription
  (`timeline-view.ts:164-169`).
- `_clear()` empties `_events` locally only (`timeline-view.ts:239-241`).
- Render is `.toolbar` → `<timeline-layers>` → `<timeline-event-list>`; the
  view performs no filtering or derivation (`timeline-view.ts:279-320`).

`src/panel/timeline-event-list.ts` renders `repeat(visible, (ev) => ev, …)` —
one `.row` per event with time, layer dot, title, subtitle
(`:339-350`), keyed by **event object identity**. Three stacked filters exist:
layer enablement (`:216-226`), an element `<select>` (`:219-223`), and a
case-insensitive regex over tag/title/subtitle (`:260-281`). The only
aggregation anywhere in `src/panel/` is `_computeElements()`, a distinct-element
dedup with no counts (`:229-238`).

### What the definition does with events today

Raw store and filter, no derivation:

- `recentEvents` is a plain array inside `setup()`, cap
  `RECENT_EVENTS_BUFFER_SIZE = 512` (`src/lib/devframe/protocol.ts:54`), FIFO
  head-splice on push (`src/lib/devframe/definition.ts:220-227`).
- `recent-events` applies `layerId` / `elementId` / `sinceMs` / `limit`
  filters and slices; `limit` defaults to 50 and is capped at 200
  (`definition.ts:402-420`).
- `groupId`, `data.changed` and `logType` are never read by any node-side
  code.
- Agent-exposed queries: `get-meta`, `list-components`,
  `hmr-incompatibilities`, `component-details`, `recent-events`. The one
  agent-exposed mutation is `set-recording` (`definition.ts:452-461`).

### The clock/buffer bug this plan has to fix first

The runtime re-zeroes its clock on the **rising edge of recording**:

```ts
// src/lib/runtime/timeline/install.ts:75-80
hot.on('lit:timeline:recording-changed', (data) => {
  const next = (data as {recording: boolean}).recording;
  // Re-zero the timeline clock on the rising edge so event times read as
  // "ms since recording started" rather than since page load.
  if (next && !state.recordingState) resetClock();
```

But nothing clears a buffer on that edge. `recentEvents.length = 0` happens
only in `runtimeReady()` (`definition.ts:255-261`), i.e. on page reconnect,
and the panel's `_events` is cleared only by the Clear button. So a
record → stop → record cycle **without a reload** leaves the previous
recording's events in both buffers with times on the old, larger origin. The
existing list only looks mildly out of order; any derivation over that buffer
produces negative durations and mispaired spans. Fix precedes derive.

## Design decisions

These were settled while planning; do not re-open them mid-implementation.

1. **Derivation lives in `src/lib/timeline/derive.ts`, not in a panel
   component.** It imports only `src/types/timeline.ts`, so both the panel and
   `definition.ts` can use it (`definition.ts` must stay framework-neutral —
   that property is why it has no Vite import) and it is unit-testable in the
   node-env `unit` project. There are no panel DOM tests today
   (`src/test/unit/` contains node-side tests only) and this plan does not add
   a browser test runner.
2. **Layer ids stay as they are.** Merging `mouse` + `keyboard` into one
   `input` layer would break `TIMELINE_LAYERS`, `LAYER_FLAGS`,
   `TimelineLayersState`, the documented built-in ids for `addTimelineEvent`
   (`docs/.../reference/runtime-api.mdx:107-110`), and
   `src/test/e2e/input-timeline_test.ts:69-74`, which asserts on the literal
   ids. The input layers earn their keep instead by being **attributed** to the
   updates they precede (step 5).
3. **The event buffer is hoisted into `src/panel/timeline-store.ts`.** A second
   view that subscribes to the same stream would double-buffer. One module
   owns the subscription, the 5000 cap and the snapshot one-shot; views read
   from it.
4. **Collapsed rows become the default; raw rows stay behind a toggle.** The
   chronological log is still the right tool for "what happened in what order"
   and for custom layers. It stops being the only tool.
5. **The panel derives client-side; the definition derives only for agents.**
   The panel holds 5000 events, the server ring holds 512 and `recent-events`
   returns at most 200. Sending derivation server-side for the panel would
   shrink its window by an order of magnitude.

## Steps

### Step 0 — Clear both buffers on the recording rising edge

Files: `src/lib/devframe/definition.ts`, `src/panel/timeline-view.ts`,
`src/test/unit/devframe_test.ts`.

1. In the `set-recording` handler (`definition.ts:462-466`), read the previous
   `recordingState` before mutating and clear `recentEvents` when it goes
   `false → true`, mirroring the runtime's `resetClock()`. Comment it with the
   reason (new time origin), not with the mechanism.
2. In the panel, clear `_events` on the same edge. `_applySession`
   (`timeline-view.ts:200-206`) already sees both the old `this._recording` and
   the incoming state, so the edge is detectable there.
3. Add a unit test next to the existing buffer tests in `devframe_test.ts`
   (see `drops buffered events from the previous page on reconnect`, :321, for
   the pattern): push events, toggle recording off then on, assert
   `recent-events` reports an empty buffer.

Verify: `pnpm run test:unit` and `pnpm exec vp check`.

### Step 1 — `src/lib/timeline/derive.ts` + unit tests

New files: `src/lib/timeline/derive.ts`, `src/test/unit/timeline-derive_test.ts`.

Pure functions over `readonly TimelineEvent[]`, no DOM, no devframe import.

```ts
export interface TimelineSpan {
  layerId: string;
  /** `${layerId}:${groupId}:${name}`, or a synthetic key for point events. */
  key: string;
  /** Event title with the `:start` / `:end` suffix stripped. */
  name: string;
  start: number;
  /** Absent while a span is still open, or when its end was evicted. */
  end?: number;
  /** `end - start`; absent for open spans and point events. */
  duration?: number;
  changed?: string[];
  subtitle?: string;
  logType?: TimelineEvent['logType'];
  meta?: TimelineEvent['meta'];
  /** Source events, for the detail pane. */
  events: TimelineEvent[];
}

export interface UpdateCycle {
  key: string;            // the `${elementId}:${tick}` groupId
  elementId: number;
  tagName: string;
  source?: {file: string; line: number};
  start: number;
  duration?: number;      // the performUpdate span's duration
  changed: string[];
  phases: TimelineSpan[];
  cause?: {type: string; detail: string; time: number}; // step 5
}

export interface ComponentRollup {
  tagName: string;
  elementIds: number[];
  updates: number;
  totalMs: number;
  maxMs: number;
  /** Changed-key frequency across the cycles, descending. */
  reasons: Array<{key: string; count: number}>;
  source?: {file: string; line: number};
}

export const toSpans = (events: readonly TimelineEvent[]): TimelineSpan[];
export const toUpdateCycles = (spans: readonly TimelineSpan[]): UpdateCycle[];
export const rollup = (cycles: readonly UpdateCycle[]): ComponentRollup[];
```

Pairing rules — get these exactly right, they are the whole step:

- **Pair on `(layerId, groupId, name)`, never on `groupId` alone.** The whole
  update tick shares one groupId (`lifecycle.ts:90-98`), so pairing by groupId
  would marry `willUpdate:start` to `performUpdate:end`. `name` is the title
  minus the `:start` / `:end` suffix, and each phase occurs at most once per
  tick, which makes the triple unique.
- Render-layer events use lit-html's numeric render id as `groupId` and the
  names `render:start` / `render:end` (`src/lib/runtime/timeline/render.ts:81-113`);
  the same triple rule covers them.
- Events with no `:start` / `:end` suffix (`connectedCallback`,
  `disconnectedCallback`, `template prep`, mouse, keyboard, and every custom
  layer) become point spans: `start` only, no `duration`, synthetic key.
- A start with no matching end stays open (`end`/`duration` absent). Render
  the open state; do not drop it and do not substitute the last-seen time.
- Guard `end >= start`. A negative delta means the buffer straddles a clock
  reset that step 0 failed to prevent — drop the duration rather than
  reporting a negative one.
- Output sorted by `start`.

`toUpdateCycles` consumes only `lit-lifecycle` spans, groups by `groupId`, and
takes `duration` from the `performUpdate` span — **not** a sum of phases.
Phases nest inside `performUpdate`, so summing double-counts. `changed` is the
union of the phase spans' `changed` arrays; only the phases that receive a
`PropertyValues` argument carry it (`willUpdate`, `update`, `updated`,
`firstUpdated`), because `changedKeys` returns `undefined` for a non-Map
argument (`identity.ts:94-96`) and `performUpdate` takes none.

`rollup` groups cycles by `tagName` (several instances of one component
aggregate; keep their ids in `elementIds`), sorts by `totalMs` descending.

Tests to write, all as hand-built `TimelineEvent[]` literals:

- a complete tick pairs into five spans with the right durations
- two phases sharing a groupId do not cross-pair
- an open span survives with no duration
- a clock-reset straddle yields no negative duration
- point events and unknown custom layers pass through as point spans
- `rollup` counts a repeated update and ranks its changed keys

Verify: `pnpm run test:unit`, `pnpm exec vp check`.

### Step 2 — Collapsed duration rows in the event list

File: `src/panel/timeline-event-list.ts`.

1. Derive spans in `willUpdate` when the `events` property changes, alongside
   the existing `_elementsCache` memoization (`:189-201`). Do not derive in
   `render()`.
2. Render one row per span by default: time, layer dot, name, subtitle, and a
   right-aligned duration (`1.8ms`, or `—` for a point span, or an open-span
   marker). Key rows by `span.key` — the current `repeat(visible, (ev) => ev)`
   keys by object identity (`:339-341`), which spans do not preserve across
   re-derivation; selection comparison (`:344`) must move to `key` too.
3. Add a `Raw` toggle to the filterbar that falls back to today's per-event
   rows. Both modes keep the existing element `<select>` and regex filter; the
   regex haystack for a span is its name, subtitle and `meta.tagName`.
4. Detail pane: add `changed` (the changed-property keys, as their own row —
   this is the headline datum, not a member of the JSON blob) and `duration`.
   Keep `layer`, `time`, `element`, `source`, `data`.
5. Preserve the autoscroll in `updated()` (`:203-208`).

Verify: `pnpm exec vp check`, then manually against the playground — see
"Manual verification" below. At this point the docs' "per-phase duration bars"
claim is true for the first time.

### Step 3 — Hoist the buffer into `src/panel/timeline-store.ts`

New file: `src/panel/timeline-store.ts`; edit `src/panel/timeline-view.ts`.

Move the subscription, the `MAX_EVENTS` tail slice, the snapshot one-shot and
the clear into a module-level store exposing `getEvents()`,
`subscribe(cb): () => void` and `clear()`. `timeline-view` becomes a consumer.
Behaviour must not change — this step is preparation for step 4 and should be
verifiable by the absence of any visible difference.

Verify: `pnpm exec vp check`; re-run the manual check from step 2.

### Step 4 — The Updates view

New file: `src/panel/updates-view.ts`; edit `src/panel/lit-devtools-panel.ts`,
`src/panel/deep-link.ts`.

Two panes over `rollup()` and `toUpdateCycles()`:

- **Top — components.** A table of `tagName`, updates, total ms, max ms, top
  changed keys, with the source link. Sorted by total ms. This is the
  "which component re-renders too much" answer.
- **Bottom — cycles for the selected component.** One row per `UpdateCycle`:
  time, duration, changed keys, and the existing `inspect` /
  `openInEditor` affordances copied from `timeline-event-list.ts:389-410`.

Wiring, all four touch points:

- `import './updates-view.js'` and an entry in `TABS`
  (`lit-devtools-panel.ts:37-41`), between Components and Timeline.
- Mount in the `.view` container (`:220-235`). Use the **lazy** pattern
  (`${this._tab === 'updates' ? html`…` : nothing}`, as Settings does) — the
  store buffers regardless of which view is mounted, so this view has nothing
  to keep alive in the background.
- Add `'updates'` to the `DeepLink.tab` union (`deep-link.ts:37`) and to
  **both** validation sites (`:46` and `:116`), plus the cast at
  `lit-devtools-panel.ts:170`. No new hash param is needed: `#component=<id>`
  already exists and the Updates view can reuse it to preselect a component,
  since it is the same stable instance id.

Verify: `pnpm exec vp check`; manual check that
`#tab=updates&component=<id>` lands on the right row.

### Step 5 — Attribute updates to the input that caused them

Files: `src/lib/timeline/derive.ts`, `src/panel/updates-view.ts`.

Add `attributeInput(cycles, events, windowMs = 200): UpdateCycle[]`, filling
`cause` from the most recent `mouse` / `keyboard` event at or before the
cycle's `start` and within `windowMs`. Render it in the cycles pane as
`after click (412, 88)` / `after keydown Enter`.

This is what makes the two input layers worth their pills: an update with a
cause is an interaction, an update without one is a timer, a signal or a
stray `requestUpdate`. Leave the layers' ids, flags, defaults and docs alone
(design decision 2).

Verify: `pnpm run test:unit` (add attribution cases — inside the window,
outside it, none present), `pnpm exec vp check`.

### Step 6 — `lit:update-summary` for agents

Files: `src/lib/devframe/protocol.ts`, `src/lib/devframe/definition.ts`,
`src/test/unit/devframe_test.ts`.

An agent that asks "why did this re-render" currently gets at most 200 raw
events and has to pair them itself, which is exactly the work step 1 now does.
Add a query that answers directly.

1. `protocol.ts`: add `RPC_UPDATE_SUMMARY = 'lit:update-summary'` beside the
   other name consts (`:56-81`), an `UpdateSummaryArgs {tagName?; sinceMs?;
limit?}` and `UpdateSummaryResult {recording; components; cycles;
bufferSize; truncated}` beside the other arg/result interfaces
   (`:141-171`), and an entry in the hand-written
   `declare module 'devframe' { interface DevframeRpcServerFunctions }` block
   (`:200-218`).
2. `definition.ts`: register it with `type: 'query'`, `jsonSerializable: true`,
   `snapshot: true`, and an `agent.description`. Copy the shape of
   `recent-events` (`:382-429`) — in particular default the argument object in
   the handler signature (`args: UpdateSummaryArgs = {}`), because `snapshot:
true` bakes the zero-argument call and agents genuinely call with no
   filters. Handler derives from `recentEvents` via `src/lib/timeline/derive.js`.
   It is a query, so it is read-safe by inference and needs no `safety` field.
3. Update the RPC-surface assertions in `devframe_test.ts` — `registers the
scoped rpc surface` (:93) and `exposes exactly one mutating tool to agents`
   (:109) both enumerate the surface. The second should still pass unchanged;
   confirm rather than assume. Add a test that the summary answers from the
   buffer with the right changed keys.

Verify: `pnpm run test:unit`, `pnpm exec vp check`.

### Step 7 — Documentation

Files: `docs/src/content/docs/guides/devtools-timeline/index.mdx`, new
`docs/src/content/docs/guides/devtools-timeline/updates.mdx`,
`docs/src/content/docs/reference/options.mdx`.

1. `index.mdx:48` — the Lifecycle row's "with per-phase duration bars and
   changed-property keys" is now true; keep it, and point it at the new page.
   Describe the Raw toggle where the event-list behaviour is described
   (`:55-59`).
2. New `updates.mdx` with `sidebar: order: 8` (it slots after
   `custom-layers.mdx`; the sidebar is autogenerated per directory, so
   `docs/astro.config.mjs` needs no change). Cover the components table, the
   cycles pane, cause attribution, and the deep link.
3. Add `lit_update-summary` to the MCP tool table (`index.mdx:192`).
4. Internal links must carry the `/vite-plugin-lit` base prefix
   (`docs/astro.config.mjs:8-12`); `starlightLinksValidator()` fails the build
   on a bad one.

Verify: `pnpm docs:build` and `pnpm run format:check` (it covers `.mdx`).

## Manual verification

The playground is the fixture. The developer usually already has one running
on port 5179 — **reuse it rather than starting a second, and never kill a dev
server by process pattern.** Otherwise `pnpm dev` (`package.json:42`).

The interesting traffic generators (`playground/index.html`):

- `hmr-counter` (:120) — the simplest deterministic single-element updater;
  one changed key per click. Use it to eyeball durations and cause
  attribution.
- `hmr-signal-counter` / `hmr-signal-mirror` (:172, :180) — two elements off
  one shared signal; the rollup should show both against one interaction.
- `hmr-clock` / `hmr-digital-clock` (:191-207) — **commented out on purpose**
  because they re-render every second and flood the timeline (:187-190).
  Uncomment them temporarily: a per-second re-render with no input cause is
  precisely what the rollup and the "no cause" state are for. Re-comment
  before committing.
- `hmr-virtualizer` (:334) — 1000 rows, bursty render traffic from one
  element; use it to check the derive cost at the 5000-event cap.

## Full verification

```
pnpm exec vp check
pnpm run test:unit
pnpm run test:e2e          # runs pnpm run build first; required
pnpm docs:build
```

`src/test/**` sits outside the root `tsconfig.json`, so the pre-commit hook
type-checks a staged test file without `@types/node` and rejects a plain
`node:fs/promises` import — use the `fsp` helper from
`src/test/e2e/utils.ts:267` if a new test needs the filesystem.

## STOP conditions

- The drift check reports changes to the cited files, and the quoted excerpts
  no longer match.
- A grep for `groupId` under `src/panel/` returns hits before step 2 — someone
  has already started this and the plan's baseline is wrong.
- `devframe_test.ts`'s RPC-surface assertion (:93) lists a different set of
  functions than "Current state" records.
- `src/lib/timeline/derive.ts` needs an import from `src/panel/` or
  `src/lib/devframe/` — that means the seam is in the wrong place; stop and
  report rather than widening it.
- Any verification command fails twice after a reasonable fix.
- A step requires changing `TIMELINE_LAYERS`, `LAYER_FLAGS` or
  `TimelineLayersState` — design decision 2 says no; stop and report.

## Rejected

- **Merging the mouse and keyboard layers into one `input` layer.** It is the
  intuitive fix for "these two pills earn nothing", and it costs the public
  built-in layer ids, two protocol types, a shipped e2e assertion and three
  docs pages, to save one pill. Attribution (step 5) gives them real value at
  a fraction of the blast radius.
- **Deleting the chronological log.** It is the right view for custom layers,
  for ordering questions, and for anything the derive rules do not model. It
  is demoted, not removed.
- **Deriving server-side for the panel.** The server ring is 512 events and
  `recent-events` returns at most 200 (`protocol.ts:54,157`); the panel holds 5000. Moving derivation to the definition for the panel's benefit would cut
  the visible window by 10×. The definition derives only for agents (step 6),
  which are bounded by the same ring anyway.
- **A flamechart / scrubber timeline.** It is what "timeline" suggests and it
  is the wrong instrument: Lit update ticks are sub-millisecond and sparse, so
  a flamechart is mostly whitespace, and the Chrome Performance panel already
  does this better for anything long enough to see. The value here is
  attribution and frequency, which are a table.
- **"Wasted render" detection.** The genuinely valuable version — an update
  that changed no DOM — cannot be determined from the current event stream
  without diffing the rendered output, and a cheap proxy (an update whose
  changed keys are unused by `render()`) would be wrong often enough to
  mislead. Revisit only with a real signal from lit-html.
