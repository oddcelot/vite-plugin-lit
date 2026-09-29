# DevTools timeline and capture

`litPlugin({timeline: true})` adds a Vue DevTools style timeline to the Lit
DevTools panel: a record-able, layered, time-ordered stream of runtime events
from the inspected page. The headline layer is Lit lifecycle (connect, update
phases, disconnect, per element, with the changed reactive properties). The
others are Lit render, mouse and keyboard. The shape is capture in the page,
forward to node, display in the panel. How the panel is hosted is in
`devframe-foundation.md`. What the panel derives from events is in
`devtools-features.md`.

## Capture decisions

- **Hybrid capture, because Lit offers two surfaces and neither is enough
  alone.**
  - The built-in `lit-debug` `CustomEvent` (enabled by
    `globalThis.emitLitDebugLogEvents = true`, dev mode only) is official and
    needs no patching. lit-html emits rich events, and `begin render` and
    `end render` share a numeric `id`, which suits a grouped render layer.
    reactive-element emits only a coarse `{kind: 'update'}` with no element
    identity, phases or changed properties. So `lit-debug` drives the render
    layer only.
  - The lifecycle layer wraps the phase methods on `ReactiveElement.prototype`
    (`connectedCallback`, `disconnectedCallback`, `performUpdate`, `willUpdate`,
    `update`, `updated`, `firstUpdated`, and so on). That gives per-phase start
    and end, element identity, and the changed keys taken from the
    `PropertyValues` map. It is the same technique `patch.ts` already uses for
    HMR.
- **`lit-debug` shapes are explicitly unstable.** The listener tolerates missing
  kinds. This is acceptable for a dev-only tool.
- **Grouping.** Each `performUpdate` tick gets `groupId = ${elementId}:${tick}`.
  Every phase's start and end shares it, so a consumer can pair them into a
  duration without heuristics. Render events use the lit-debug `id`. `commit`
  and `set part` events are high volume and stay out of the default set.
- **Identity.** Elements get a monotonic id from a `WeakMap`, never a property
  on the element, so ids survive HMR because patching keeps the same instance.
  The source location comes from the
  `Symbol.for('@lit-labs/vite-plugin-lit#source')` metadata that the source
  overlay already attaches, so a row can open the file in the editor.
- **Time is recording-relative.** `runtime/timeline/clock.ts` re-zeroes on each
  rising edge of recording, so times read as ms since recording started rather
  than since page load. The panel iframe has its own time origin, so page-load
  time would be meaningless to it. Consequence: `time` has no relationship to
  any node clock, and a time-window filter must be relative to the newest
  buffered event.
- **Gating is cheap and layered.** A master recording flag and per-layer flags
  short-circuit before any event object is built. The prototype wrappers are
  installed once and cost one boolean check when idle. Nothing is captured, and
  no patch or `emitLitDebugLogEvents` is set, in production builds.
- **Batching.** The transport coalesces per microtask before sending, because
  lit-html emits far more events per render than Vue does. A late flush drains
  the queue and pending `addTimelineLayer` calls when the HMR client connects,
  so calls made at module-init time, before the install ran, are not dropped.
- **Patch the app's own Lit instance.** The wrappers must land on the exact
  `ReactiveElement` the app loads. Duplicate copies of Lit would mean missed
  events. The plugin's import rewriting (`src/lib/wrap-table.ts`) and its
  exclusion of itself from prebundling exist for the same single-instance
  reason.

## Public API

`virtual:lit-plugin/timeline` exports `addTimelineEvent` and `addTimelineLayer`
so app code and other plugins can add custom layers.

- **It resolves in build as well as serve, to a no-op stub.** Its `resolveId`
  and `load` once lived on the serve-only HMR plugin, so `vite build` could not
  resolve a documented import. `litTimelineVirtual`
  (`src/lib/plugins/timeline-virtual.ts`) now has no `apply` and returns the
  stub under build unconditionally, even with `timeline: true`. The real module
  delivers over `import.meta.hot`, so in a production bundle it would be a queue
  that never drains.
- **It is typed by an ambient declaration in `client.d.ts`,** not by a package
  subpath export. A real subpath would let consumers import `public-api.ts`
  directly and bypass the stub's production safety. The declaration duplicates
  the small `TimelineLayer` and `TimelineEvent` shapes, including `meta`,
  because a narrowed public type would be stricter than what the runtime
  accepts. It freezes those shapes as public API, and adding a required field is
  now a breaking change. `scripts/check-client-types.mjs` guards the two copies
  against drifting.

## Invariants

- Any wrapper on a Lit prototype method must either re-arm after each hot patch
  (the `instrument()` pattern in `patch.ts`) or resolve the implementation
  lazily through the prototype chain. HMR copies new members onto the existing
  prototype, so a closure over the old function object goes stale. The
  inspector's element watch hit exactly this and now looks the method up on each
  call.
- The source-overlay metadata assignment is appended at module end. It must only
  be emitted for classes declared at module top level. A class inside a function
  or block would throw a `ReferenceError` at module evaluation and take the
  whole module down. Nested declarations lose overlay metadata instead of
  crashing.
- A recording rising edge clears the node ring buffer and the panel buffer (see
  `devtools-features.md`), because the clock re-zeroes there. Do not derive
  anything across two recordings.

## Source

`src/lib/runtime/timeline/` (install, lifecycle, render, input, identity,
transport, clock, public-api), `src/types/timeline.ts`,
`src/lib/plugins/timeline-virtual.ts`, `src/panel/timeline-*.ts`.
