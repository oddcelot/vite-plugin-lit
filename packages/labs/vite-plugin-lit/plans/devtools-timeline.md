# Plan: Lit DevTools Timeline (Vue DevTools–style) for `@lit-labs/vite-plugin-lit`

Status: **implemented — all phases shipped**
Branch: `feat/devtools-timeline`
Author: planning pass, 2026-06-14
Implementation: 2026-06-14

---

## What shipped

All five phases were implemented in 13 atomic commits on `feat/devtools-timeline`.
The feature is enabled with `litPlugin({timeline: true})` in `vite.config.ts`.

### Architecture as built

```
┌─── browser (app) ───────────────────────────────────┐
│  src/lib/runtime/timeline/install.ts (injected)      │
│   • installLifecycleLayer  → ReactiveElement.proto   │
│   • installRenderLayer     → lit-debug CustomEvent   │
│   • installMouseLayer      → window mouse listeners  │
│   • installKeyboardLayer   → window keyboard listen  │
│   • transport.ts           → microtask-batched send  │
│                                    │                  │
│  virtual:lit-plugin/timeline (opt-in)                 │
│   • addTimelineEvent(event) → emit()                  │
│   • addTimelineLayer(layer) → HMR announce            │
└─────────────────────────────────────────────────────┘
                             │ HMR lit:timeline:push-event
┌─── Vite node ───────────────────────────────────────┐
│  src/lib/timeline-plugin.ts                          │
│   • SSE fan-out: /__lit-timeline-events              │
│   • Panel HTML: /__lit-timeline/ (/@fs/ injection)   │
│   • Control: /__lit-timeline-control (POST)          │
│   • HMR relay: recording + layers → broadcast        │
│   • devtools.setup: dock entry registered            │
└─────────────────────────────────────────────────────┘
                             │ SSE
┌─── panel iframe ────────────────────────────────────┐
│  src/panel/timeline-app.ts      root LitElement      │
│  src/panel/timeline-layers.ts   layer pill toggles   │
│  src/panel/timeline-event-list.ts  scrollable log    │
│   • EventSource /__lit-timeline-events               │
│   • POST /__lit-timeline-control (recording/layers)  │
│   • localStorage layer state persistence             │
│   • Detail pane: tag, element id, source deep-link   │
└─────────────────────────────────────────────────────┘
```

### Files added

| File                                     | Purpose                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/types/timeline.ts`                  | Shared data types: `TimelineEvent`, `TimelineLayer`, `TimelineLayersState`, `TIMELINE_LAYERS`             |
| `src/lib/timeline-plugin.ts`             | Vite plugin: SSE endpoint, panel HTML middleware, control endpoint, HMR relay, devtools dock registration |
| `src/lib/runtime/timeline/install.ts`    | Browser entry: wires all layers, HMR channel, state                                                       |
| `src/lib/runtime/timeline/transport.ts`  | Microtask-batched HMR send; late-flush when client connects                                               |
| `src/lib/runtime/timeline/lifecycle.ts`  | `ReactiveElement.prototype` wrap for lifecycle phases                                                     |
| `src/lib/runtime/timeline/render.ts`     | `lit-debug` CustomEvent listener for render layer                                                         |
| `src/lib/runtime/timeline/input.ts`      | Mouse + keyboard `window` listeners                                                                       |
| `src/lib/runtime/timeline/identity.ts`   | WeakMap element ids, source-meta lookup, changed-key extraction                                           |
| `src/lib/runtime/timeline/public-api.ts` | `addTimelineEvent` / `addTimelineLayer` (Phase 5 API)                                                     |
| `src/panel/index.html`                   | Minimal shell; entry script injected dynamically                                                          |
| `src/panel/timeline-app.ts`              | Root `<timeline-app>` LitElement                                                                          |
| `src/panel/timeline-event-list.ts`       | Scrollable event log with click-to-detail                                                                 |
| `src/panel/timeline-layers.ts`           | Layer pill toggle strip                                                                                   |
| `src/test/e2e/timeline_test.ts`          | e2e: SSE content-type, panel HTML, control endpoint, script injection                                     |

### Files modified

| File                        | Change                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `src/lib/plugin.ts`         | `timeline` option wiring, runtime injection, `virtual:lit-plugin/timeline` resolveId/load |
| `tsconfig.json`             | Exclude `src/panel/**` (compiled by Vite/esbuild, not tsc)                                |
| `playground/vite.config.ts` | `litPlugin({timeline: true})` enabled                                                     |
| `README.md`                 | `timeline` option docs, `## Timeline` section with layer table and public API example     |

### Key design decisions

**`/@fs/` for the panel** — the panel HTML is served dynamically by a `configureServer` middleware that injects a `<script type="module" src="/@fs/...timeline-app.ts">`. Vite's transform pipeline compiles the TypeScript and resolves bare `lit` imports. No separate panel build step needed in dev.

**`src/panel/**`excluded from tsc** — the panel files use`experimentalDecorators`(Lit`@state`/`@property`) but the plugin's own tsconfig does not. They're excluded from the plugin's `tsc`check; Vite/esbuild uses the playground's tsconfig (which has`experimentalDecorators: true`) to transform them.

**Control endpoint over postMessage** — `window.parent.postMessage` would require the Vite DevTools shell to intermediate. `fetch POST /__lit-timeline-control` goes directly to the Vite server and works regardless of whether the devtools overlay is active.

**Late-flush in transport** — `setHotClient()` now drains the event queue and fires pending `addTimelineLayer` callbacks, so calls at module-init time (before `install.ts` has run) are not silently dropped.

**`virtual:lit-plugin/timeline`** — resolves to `public-api.ts` when `timeline` is enabled, or a no-op stub otherwise. Safe to import unconditionally in component code; adds no overhead in production.

### Layers

| ID              | Label         | Color     | Source                                                                           |
| --------------- | ------------- | --------- | -------------------------------------------------------------------------------- |
| `lit-lifecycle` | Lit Lifecycle | `#4fc08d` | `ReactiveElement.prototype` wrap; start/end pairs with `groupId` per update tick |
| `lit-render`    | Lit Render    | `#325cff` | `lit-debug` `begin/end render` CustomEvents                                      |
| `mouse`         | Mouse         | `#a451af` | `window` mousedown/up/click/dblclick                                             |
| `keyboard`      | Keyboard      | `#8151af` | `window` keydown/keyup                                                           |

### What is NOT yet done

- Verbose render toggle (commit/set-part events from lit-debug — currently suppressed as too noisy)
- `@lit-labs/virtualizer` for the event list (scrollable div used instead; virtualizer deferred)
- Playwright test for actual event capture (current e2e covers infrastructure only)
- Published-package panel build (panel `.ts` files are dev-only via `/@fs/`; a production `panel/` dist would need a separate build step)

---

## Goal

Add a Vue-DevTools-style **Timeline** panel to the plugin's dev experience: a
record-able, layered, time-ordered stream of runtime events. The headline layer
is **Lit lifecycle / reactive updates** (component connect/update/render/disconnect
with phase breakdown and per-element identity), alongside mouse, keyboard, and
lit-html render layers — mirroring Vue DevTools' four built-in layers.

The panel surfaces inside the **Vite DevTools** the playground already wires up
(`@vitejs/devtools` 0.3.3), not a bespoke floating window.

Reference architecture studied: Vue DevTools timeline at
`/Users/oddcelot/Code/reference/vue-devtools` — `devtools-kit` (capture),
`core` (RPC bridge), `applet`/`client` (UI). We replicate the
**capture → forward (RPC) → display** shape, adapted to Lit + the new Vite
DevTools (`devframe`-based) plugin model.

---

## TL;DR feasibility verdict

**Yes — capturing Lit lifecycle events is feasible, and Lit gives us two
complementary capture surfaces:**

1. **Built-in `lit-debug` CustomEvent system (official, unstable, zero-patch).**
   Both `reactive-element` and `lit-html` dispatch `window`-level
   `CustomEvent('lit-debug', {detail})` events in **DEV_MODE**, gated by a global
   flag `globalThis.emitLitDebugLogEvents = true`.
   - `packages/reactive-element/src/reactive-element.ts:158` — `debugLogEvent()`
     dispatcher; emits `{kind: 'update'}` from `performUpdate()` at
     `reactive-element.ts:1446`. **Coarse** — one event per update, no element
     identity, no phase split, no changed-properties.
   - `packages/lit-html/src/lit-html.ts:196` — same dispatcher; emits ~14 rich
     kinds: `template prep`, `template instantiated`,
     `template instantiated and updated`, `template updating`, `begin render`,
     `end render`, `set part`, and the `commit *` family. **`begin render` /
     `end render` carry a matching numeric `id`** — ideal for a grouped
     start/end timeline layer. Types: `LitUnstable.DebugLog.*` at
     `lit-html.ts:40-182`.

   Good for a **render layer** out of the box. Not good enough alone for a rich
   component-lifecycle layer (the reactive-element event is just `{kind:'update'}`).

2. **Runtime prototype instrumentation of `ReactiveElement` (richer, opt-in).**
   To match Vue's "performance" layer (per-component, per-phase start/end with
   durations and identity) we wrap the lifecycle methods on
   `ReactiveElement.prototype` at dev runtime. Methods + signatures
   (from `reactive-element.ts`):
   - `connectedCallback()` `:1137`
   - `disconnectedCallback()` `:1159`
   - `performUpdate()` `:1439` (the update cycle entry; brackets the whole tick)
   - `willUpdate(changed)` `:1553`
   - `update(changed)` `:1655`
   - `firstUpdated(changed)` `:1693`
   - `updated(changed)` `:1675`
   - `shouldUpdate(changed)` `:1642`
   - `attributeChangedCallback(name, old, value)` `:1175`

   `changed` is `PropertyValues` (a `Map<PropertyKey, unknown>` of old values),
   so we can report _which_ properties triggered the update. Wrapping at the
   prototype level is consistent with what the plugin already does (it patches
   classes for HMR in `src/lib/runtime/patch.ts`).

   Optional bonus layer: **ReactiveController** hooks
   (`hostConnected/hostDisconnected/hostUpdate/hostUpdated`,
   `packages/reactive-element/src/reactive-controller.ts:53`).

**Recommended capture strategy: hybrid.**

- **Lifecycle layer** → prototype instrumentation of `ReactiveElement` (rich,
  grouped start/end per phase, element identity, changed props).
- **Render layer** → built-in `lit-debug` (`begin/end render`, `template prep`),
  enabled via `globalThis.emitLitDebugLogEvents = true`. Free, accurate, no patch.
- **Mouse / Keyboard layers** → DOM listeners on `window` (identical to Vue).

---

## How Lit instances are identified

For per-element identity in the timeline we need a stable id + a readable label.

- **Label**: `el.localName` (tag name) + a per-instance counter, e.g.
  `my-counter #3`. Source-overlay metadata already attaches author file/line via
  `Symbol.for('@lit-labs/vite-plugin-lit#source')` (see `src/lib/source-meta.ts`
  and `src/lib/runtime/source-overlay/source-host.ts`) — reuse it so a timeline
  row can deep-link "open in editor", consistent with the existing overlay.
- **Stable id**: assign a monotonic id via a `WeakMap<ReactiveElement, number>`
  in the instrumentation runtime (do **not** mutate the element). This survives
  HMR because the plugin patches in place (same instance identity).
- **Grouping**: each `performUpdate` tick gets a `groupId` (the instance id +
  tick counter). `willUpdate`/`update`/`render`/`updated` start/end events share
  that `groupId`, so the panel can render a single expandable update group with
  phase sub-bars — exactly Vue's perf-layer grouping (`groupId` in
  `devtools-kit/src/types/timeline.ts`).

---

## Target architecture (mirrors Vue's 3 stages)

```
┌─────────────────────────── browser (app) ───────────────────────────┐
│  client runtime  (injected via ClientScriptEntry)                    │
│   • installs DOM listeners (mouse, keyboard)                         │
│   • sets globalThis.emitLitDebugLogEvents = true                    │
│   • addEventListener('lit-debug', …)  → render layer                │
│   • patches ReactiveElement.prototype  → lifecycle layer            │
│   • all gated by recordingState + per-layer enabled flags           │
│   • buffers + forwards events  ──RPC──►                              │
└──────────────────────────────────┬──────────────────────────────────┘
                                    │ devframe RPC (getDevToolsRpcClient)
┌──────────────────────────────────▼──────────────────────────────────┐
│  node plugin  (createPluginFromDevframe)                             │
│   • RPC function: pushTimelineEvent(layerId, event)                 │
│   • shared state: timelineLayersState (recording + per-layer flags) │
│   • broadcasts events to the panel client                           │
└──────────────────────────────────┬──────────────────────────────────┘
                                    │ broadcast
┌──────────────────────────────────▼──────────────────────────────────┐
│  panel SPA  (Lit element, served as the devframe view/iframe)       │
│   • subscribes to timeline-event-updated                            │
│   • virtual-scrolled, color-coded layer rows + group bars           │
│   • record toggle + per-layer toggles (writes shared state)         │
└──────────────────────────────────────────────────────────────────────┘
```

### Why this maps cleanly to the existing plugin

The plugin already does every primitive this needs:

- **Inject browser runtime**: it injects `patch.ts`, the HMR indicator, and the
  source overlay via virtual modules + `transformIndexHtml` (`src/lib/plugin.ts`).
  The timeline client runtime is one more injected module.
- **Dev middleware / server wiring**: `configureServer` already registers
  `/__lit-open-in-editor`; the devframe mount is the same class of work.
- **Runtime instrumentation**: `src/lib/runtime/patch.ts` already wraps custom
  element classes. Lifecycle instrumentation is a sibling runtime module.
- **Import rewriting**: `src/lib/wrap-table.ts` already rewrites
  `lit`/`lit-html`/`reactive-element` specifiers — useful if we prefer wrapping
  the _imported_ base class over global prototype patching.

### Vite DevTools plugin model (the new `@vitejs/devtools` 0.3.x)

This is **not** the Vue birpc model. `@vitejs/devtools` is built on
`@devframes/hub` / `devframe`. Confirmed from the installed types under
`playground/node_modules/@vitejs/devtools-kit/dist`:

- **`createPluginFromDevframe(d, options)`** (`node/index.d.ts`) — wraps a
  `DevframeDefinition` as a Vite plugin that mounts inside Vite DevTools: serves
  the panel SPA, registers an iframe dock entry, runs `d.setup(ctx)`.
- **`defineRpcFunction`** (`index.d.ts`) — typed RPC functions between
  client/panel and node.
- **`createSharedState`** (`utils/shared-state.d.ts`) — reactive shared state
  (our `timelineLayersState`, replacing Vue's localStorage approach; persistence
  can layer on top).
- **`createSimpleClientScript` / `ClientScriptEntry`** (`node/index.d.ts`) —
  inject client-side runtime code for a dock entry (`@experimental`; prefer a
  real importable module for the production runtime).
- **Client side**: `getDevToolsClientContext()` / `getDevToolsRpcClient()`
  (`client.d.ts`) to reach RPC + dock state from the injected runtime and the
  panel.
- **`defineDockEntry`** — the dock/panel registration (icon, category, view).

> ⚠️ The exact `DevframeDefinition` SPA-definition surface (how the panel's
> built assets are declared/served) lives in `@devframes/hub` and should be
> confirmed against that package at implementation start — the kit re-exports
> but does not fully document it in its `.d.ts`. Spike this first (Phase 0).

---

## Data model (ported from Vue, trimmed)

```ts
// types/timeline.ts
export interface TimelineLayer {
  id: string; // 'lit-lifecycle' | 'lit-render' | 'mouse' | 'keyboard'
  label: string;
  color: number; // 0xRRGGBB, matches Vue convention
}

export interface TimelineEvent<TData = unknown> {
  layerId: string;
  time: number; // performance.now()
  data: TData;
  title?: string;
  subtitle?: string;
  groupId?: number | string; // pair/own start↔end (update group)
  logType?: 'default' | 'warning' | 'error';
  meta?: {
    // identity for deep-linking
    elementId?: number;
    tagName?: string;
    source?: {file: string; line: number};
  };
}

export interface TimelineLayersState {
  recordingState: boolean;
  litLifecycleEnabled: boolean;
  litRenderEnabled: boolean;
  mouseEventEnabled: boolean;
  keyboardEventEnabled: boolean;
}
```

### Built-in layers

| id              | label         | color (Vue-ish) | source                                |
| --------------- | ------------- | --------------- | ------------------------------------- |
| `lit-lifecycle` | Lit Lifecycle | `0x4FC08D`      | prototype instrumentation (start/end) |
| `lit-render`    | Lit Render    | `0x325CFF`      | `lit-debug` `begin/end render`        |
| `mouse`         | Mouse         | `0xA451AF`      | `window` mouse listeners              |
| `keyboard`      | Keyboard      | `0x8151AF`      | `window` keyboard listeners           |

(Colors picked to echo Vue DevTools; finalize against the Lit brand palette.)

---

## Capture details

### Lifecycle layer (prototype instrumentation)

`src/lib/runtime/timeline/lifecycle.ts` — installed once by the client runtime.

```ts
// pseudocode
const ids = new WeakMap<ReactiveElement, number>();
let nextId = 0;
let tick = 0;

function instrument(proto, name, phase) {
  const orig = proto[name];
  proto[name] = function (...args) {
    if (!recording() || !layerEnabled('lit-lifecycle'))
      return orig.apply(this, args);
    const id = idOf(this);
    const group = `${id}:${tick}`;
    emit({
      layerId: 'lit-lifecycle',
      time: performance.now(),
      groupId: group,
      title: phase,
      subtitle: this.localName,
      data: {phase, changed: changedKeys(args[0])},
      meta: {elementId: id, tagName: this.localName, source: sourceOf(this)},
    });
    try {
      return orig.apply(this, args);
    } finally {
      emit({
        /* …phase end, same group… */
      });
    }
  };
}
```

- Bracket `performUpdate` (`:1439`) to delimit the whole update tick and bump
  `tick`. Bracket `willUpdate`/`update`/`updated`/`firstUpdated` for phase bars.
- `connectedCallback`/`disconnectedCallback` are point events (no end), tagged
  with element identity.
- **Resolve the prototype** by reaching the actual `ReactiveElement` the app
  loaded. Cleanest: hook the global registration — `reactive-element.ts:1745`
  pushes to `globalThis.reactiveElementVersions`. We can grab the constructor via
  a defined element's prototype chain, or (preferred) export an instrument entry
  from the runtime that the wrap-table wires to the rewritten
  `reactive-element` / `lit-element` import so we patch the exact class instance
  the app uses (avoids multi-copy mismatches — note the plugin already excludes
  itself from prebundling for the same single-instance reason, `src/lib/plugin.ts`).

### Render layer (`lit-debug`, no patch)

`src/lib/runtime/timeline/render.ts`:

```ts
globalThis.emitLitDebugLogEvents = true; // only set in dev
window.addEventListener('lit-debug', (e) => {
  if (!recording() || !layerEnabled('lit-render')) return;
  const d = e.detail; // LitUnstable.DebugLog.Entry | ReactiveUnstable…
  switch (d.kind) {
    case 'begin render':
      start(d.id, d);
      break; // groupId = d.id
    case 'end render':
      end(d.id, d);
      break;
    case 'template prep':
      point(d);
      break;
    // commit */set part: optionally a verbose sub-layer, default off (noisy)
  }
});
```

`begin render`/`end render` share `id` → grouped duration bar. The `commit *` /
`set part` events are high-volume; expose them only behind a "verbose" toggle.

### Mouse / Keyboard layers

Plain `window.addEventListener` for `mousedown/up/click/dblclick` and
`keydown/up/press`, capturing `{type, x, y}` / `{type, key, modifiers}`. Direct
port of `vue-devtools/packages/devtools-kit/src/core/timeline/index.ts`.

### Gating & overhead

- **Master switch**: nothing is captured unless `recordingState` is on.
- **Per-layer flags** short-circuit before building event objects.
- `emitLitDebugLogEvents` is only set true in **dev** and only while a Lit-aware
  layer is enabled; it's a no-op in production builds (`DEV_MODE` is compiled out).
- Prototype patches are installed once and cheap when recording is off (single
  boolean check before delegating to the original).
- Mirror Vue's `highPerfModeEnabled` escape hatch as a plugin option to disable
  the whole feature.

---

## Forward (RPC)

- Node side registers `pushTimelineEvent` via `defineRpcFunction`; client runtime
  calls it through `getDevToolsRpcClient()`.
- `timelineLayersState` lives in a `createSharedState` store; both the injected
  runtime (read: should-I-capture) and the panel (write: toggles) bind to it.
  This replaces Vue's localStorage+RPC dance with devframe's reactive shared
  state; add localStorage persistence on the panel as a thin extra.
- Node broadcasts `timeline-event-updated` to the panel (Vue analog:
  `core/src/rpc/global.ts:184` → `TIMELINE_EVENT_UPDATED`).
- **Batching**: coalesce events with `queueMicrotask`/rAF before RPC send to
  avoid a message per `commit` during a busy render (Vue sends per-event; we have
  higher-frequency `lit-html` events, so batch).

---

## Display (panel SPA — dogfood Lit)

`src/panel/` — a small **LitElement** SPA, served as the devframe view. Building
the Lit DevTools panel _in Lit_ is good dogfooding and keeps the toolchain single.

- Subscribe to `timeline-event-updated`; push into a reactive event buffer.
- Layer rows with color dots; grouped events render as expandable bars
  (start→end duration). Reuse `@lit-labs/virtualizer` (already a plugin
  devDependency) for the virtual-scrolled event list — Vue uses a virtual list
  for the same reason.
- Top bar: **record toggle** + per-layer enable checkboxes (write shared state).
- Row click → detail pane (changed props, render id, source link → reuse the
  existing open-in-editor middleware `/__lit-open-in-editor`).

Vue UI references for parity (structure only):
`vue-devtools/packages/applet/src/components/timeline/index.vue` (event receive +
list) and `client/src/components/timeline/TimelineLayers.vue` (toggle/record UI).

---

## File layout (new)

```
packages/labs/vite-plugin-lit/
├── plans/
│   └── devtools-timeline.md            ← this file
├── src/
│   ├── lib/
│   │   ├── timeline-plugin.ts          ← createPluginFromDevframe wiring, RPC, shared state
│   │   └── runtime/
│   │       └── timeline/
│   │           ├── install.ts          ← entry: wires recording state + all layers
│   │           ├── transport.ts        ← buffer + batched RPC forward
│   │           ├── lifecycle.ts        ← ReactiveElement prototype instrumentation
│   │           ├── render.ts           ← lit-debug listener
│   │           ├── input.ts            ← mouse + keyboard listeners
│   │           └── identity.ts         ← WeakMap id + source-meta lookup
│   ├── panel/                          ← Lit SPA for the devframe view
│   │   ├── index.html
│   │   ├── timeline-app.ts
│   │   ├── timeline-event-list.ts
│   │   └── timeline-layers.ts
│   └── types/timeline.ts
```

Add an option to `LitPluginOptions` (`src/lib/types.ts`):
`timeline?: boolean | { layers?; verboseRender?; }` (default off while
experimental). The main plugin factory (`src/lib/plugin.ts`) conditionally
appends the timeline plugin to its returned `Plugin[]`.

---

## Phased implementation

**Phase 0 — devframe spike (de-risk).** Stand up the smallest possible Vite
DevTools panel via `createPluginFromDevframe` that shows "hello" and round-trips
one RPC call client→node→panel. Confirms the `@devframes/hub` SPA/view definition
surface and the injected-client-script path before building anything real.

**Phase 1 — capture proof in playground.** No panel yet. Set
`emitLitDebugLogEvents = true` and patch `ReactiveElement.prototype`; `console.log`
lifecycle + render events from a playground component (`playground/src/hmr-*.ts`).
Validates identity, grouping, changed-props, and that we patch the _single_ Lit
instance correctly. (Per memory: rebuild `lib/` — the playground dev server
serves built output, not `src/lib/runtime/**` directly.)

**Phase 2 — transport.** Wire `pushTimelineEvent` RPC + `timelineLayersState`
shared state + batched forwarding. Verify events reach node and the recording/
layer gates work end to end.

**Phase 3 — panel.** Build the Lit SPA: layer rows, grouped bars, virtual list,
record + per-layer toggles, detail pane with source deep-link.

**Phase 4 — input layers + polish.** Mouse/keyboard layers, verbose-render
toggle, colors/icons, localStorage persistence, `timeline` plugin option +
README/docs, e2e test (Playwright, alongside existing `src/test/e2e`).

**Phase 5 (optional) — public layer API.** Expose `addTimelineLayer` /
`addTimelineEvent` so app authors/other plugins can add custom layers (Vue's
`api.addTimelineLayer`). Lets e.g. `@lit-labs/signals` or `@lit/task` contribute
their own layers.

---

## Open questions / risks

1. **Single Lit instance.** Prototype patching must target the exact
   `ReactiveElement` the app loads. Multiple copies (monorepo/duplicate deps)
   would mean missed events. The wrap-table import-rewrite path is the safest
   anchor; confirm against the prebundle-exclusion logic in `src/lib/plugin.ts`.
2. **Unstable APIs.** `emitLitDebugLogEvents` + `lit-debug` detail shapes are
   `*Unstable.DebugLog.*` — explicitly unstable. Pin behavior with a runtime
   feature check and tolerate missing kinds. Acceptable for a dev-only tool.
3. **`@devframes/hub` surface is young** (`@vitejs/devtools` 0.3.3). Panel
   definition + client-script injection APIs may shift; Phase 0 spike + a thin
   adapter layer isolates churn.
4. **Event volume.** `commit`/`set part` from `lit-debug` are high-frequency.
   Keep them behind a verbose toggle and batch all RPC sends.
5. **Production safety.** Entire feature is dev-only; ensure no runtime, no
   `emitLitDebugLogEvents`, and no prototype patches leak into production builds
   (gate in the plugin's `apply: 'serve'` / `mode` checks, like existing dev
   features).

---

## Key reference paths

Lit (this repo):

- `packages/reactive-element/src/reactive-element.ts` — lifecycle methods
  (`:1137`–`:1693`), `debugLogEvent` (`:158`), update emit (`:1446`), version
  global (`:1745`).
- `packages/lit-html/src/lit-html.ts` — `LitUnstable.DebugLog` types (`:40-182`),
  `debugLogEvent` (`:196`), `begin/end render` with `id`.
- `packages/lit-element/src/lit-element.ts` — `update`/`render` (`:162`/`:230`).
- `packages/reactive-element/src/reactive-controller.ts:53` — controller hooks.

Plugin (this package):

- `src/lib/plugin.ts` — factory, virtual modules, `transformIndexHtml`,
  `configureServer`, prebundle exclusion.
- `src/lib/runtime/patch.ts` — existing class instrumentation pattern.
- `src/lib/wrap-table.ts` — import rewriting for lit-family specifiers.
- `src/lib/source-meta.ts` + `src/lib/runtime/source-overlay/source-host.ts` —
  source metadata symbol for deep-linking.
- `playground/vite.config.ts` — `DevTools()` + `devtools: {enabled, clientAuth}`.

Vite DevTools types (installed):

- `playground/node_modules/@vitejs/devtools-kit/dist/node/index.d.ts` —
  `createPluginFromDevframe`, `createSimpleClientScript`, `ClientScriptEntry`.
- `.../dist/index.d.ts` — `defineRpcFunction`, `defineDockEntry`,
  `defineJsonRenderSpec`.
- `.../dist/client.d.ts` — `getDevToolsClientContext`, `getDevToolsRpcClient`.
- `.../dist/utils/shared-state.d.ts` — `createSharedState`.

Vue DevTools reference:

- `/Users/oddcelot/Code/reference/vue-devtools/packages/devtools-kit/src/core/timeline/{index,storage,perf}.ts`
- `.../devtools-kit/src/types/timeline.ts`, `.../ctx/{timeline,hook}.ts`
- `.../core/src/rpc/global.ts:184`
- `.../applet/src/components/timeline/index.vue`,
  `.../client/src/components/timeline/TimelineLayers.vue`
