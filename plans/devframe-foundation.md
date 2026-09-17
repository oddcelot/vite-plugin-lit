# Plan: Lit DevTools on Devframe

Status: **phases 1–2 done** — the panel runs on devframe and the bespoke
transport is deleted. Verified end to end in the playground: dock registered in
the Vite DevTools hub, timeline events streaming, inspector round-tripping, and
three read-only MCP tools answering. Phases 3–4 (in-page channel, CLI/static
build) are open.
Author: design pass, 2026-09-17

---

## Why

The timeline/inspector panel (`plans/devtools-timeline.md`) ships its own
transport: an SSE endpoint, four `POST` middlewares, a hand-rolled origin check,
and a bag of `server.hot` channel names, all under one duck-typed
`devtools.setup()` dock registration. Vite DevTools 0.7.x is now built on
[Devframe](https://devfra.me) (`@vitejs/devtools` → `devframe@1.0.0`,
`@devframes/hub`), so the host already runs the RPC, shared-state, streaming,
auth and MCP machinery we reimplemented. Moving onto it:

- deletes the bespoke transport (`/__lit-devtools-*`, `isTrustedRequest`, SSE
  replay hacks, two `EventSource`s per panel);
- gives the panel typed RPC, reconnect-safe state, and a trust handshake for
  free;
- makes the same definition runnable as a standalone dev server, a static
  snapshot, a CLI, and an MCP server for coding agents, with no Vite in the
  loop.

## Primitive mapping

| Today (bespoke)                                                      | Devframe primitive                                                                                            | Notes                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ctx.docks.register({type:'iframe', url: PANEL_PATH})`               | `defineDevframe({ id: 'lit', clientAssets, dock })` mounted with `ctx.install()` from our own `devtools` hook | Hub serves the SPA at `/__lit/` and registers the dock. No manual middleware.                             |
| `GET /__lit-devtools-events` (SSE, `TimelineEvent[]` batches)        | `ctx.rpc.streaming.create('timeline', { replayWindow })`                                                      | Chunk feed with replay on reconnect. One channel, one stream per recording session.                       |
| `GET /__lit-devtools-events` `event: layer` / `event: inspect`       | Shared state (`layers`) / `ctx.rpc.broadcast()` to a client function                                          | Layers are a snapshot; inspector messages are transient pushes.                                           |
| `POST /__lit-devtools-control` (recording, layer toggles)            | Shared state `session` `{ recording, layers }`, mutated from the panel                                        | Survives reconnect; every surface (panel, runtime, MCP) reads one authority.                              |
| `GET/POST /__lit-devtools-settings` + `localStorage` override        | `my.settings.project` / `my.settings.global` via `ctx.scope('lit')`                                           | File-backed, synced to peers, typed through `DevframeSettingsRegistry`.                                   |
| `POST /__lit-devtools-inspect` → `server.hot.send(INSPECT_CMD)`      | `type: 'action'` RPC functions (`inspect-tree`, `inspect-details`, `inspect-highlight`, `inspect-pick`)       | Node forwards to the page runtime (see transport below).                                                  |
| `GET /__lit-open-in-editor` + `launch-editor`                        | `@devframes/service-open` (`ctx.services.get('@devframes/service-open')`)                                     | Path containment + known-editor picklist. Drop `launch-editor` dep once migrated.                         |
| `isTrustedRequest()` origin check                                    | Devframe trust handshake (localhost bind, bearer token, `ensureTrusted()`)                                    | Never set `auth: false` outside local playgrounds.                                                        |
| `window.parent.__VITE_DEVTOOLS_CLIENT_CONTEXT__.docks.switchEntry()` | `ctx.docks.activate('lit')` from node, or `getDevframeClientContext().docks` in a client script               | No reaching into the parent frame.                                                                        |
| panel → `fetch()` + `EventSource`                                    | `connectDevframe().scope('lit')` → `rpc.call`, `rpc.sharedState`, `rpc.streaming.subscribe`                   | One WS connection, typed.                                                                                 |
| n/a                                                                  | `agent: { description, safety }` on query RPCs + `ctx.agent.registerResource()`                               | Coding agents get `lit_get-meta`, `lit_list-components`, `lit_component-details` over the hub's `/__mcp`. |

### Page runtime ↔ node transport

The inspected app's page is the one surface Devframe does not own. Two options:

1. **Keep `import.meta.hot` for the page runtime, bridge in the Vite host
   `setup()`.** Our `devtools.setup(ctx)` hook runs with `ctx.viteServer`.
   The Vite-specific bridge subscribes to
   `server.hot.on('lit:timeline:push-event')` and writes into the devframe's
   stream; it forwards inspector actions with `server.hot.send`. The
   definition stays Vite-free (the bridge is an injected _source_), and the
   existing `src/lib/runtime/**` is untouched in phase 1.
2. **Page runtime dials the hub directly** with `getDevToolsRpcClient()` from
   `@vitejs/devtools-kit/client` (the hub already injects
   `/__devtools/embedded.js` into the page). Then the runtime registers client
   functions (`inspect-*`) that node calls via `rpc.broadcast({ filter })`, and
   pushes events with `rpc.callEvent`. Works outside Vite too.

Phase 1 takes option 1 (lowest risk, keeps runtime and e2e fixtures intact).
The definition exposes a `TimelineSource` port so option 2 or a static-build
replay can plug in later. Panel ↔ page loops that never need node (highlight,
pick) can move to the **in-page channel** (`createPageScriptChannel` /
`connectPanelChannel`) in phase 3 so they also work in static builds.

## Architecture (as built)

```
┌── app page ──────────────────────────────┐   ┌── panel iframe (/__lit/) ───────────┐
│ runtime/timeline/install.ts              │   │ Lit SPA, built with Vite, base './' │
│ runtime/inspector/install.ts             │   │ connectDevframe().scope('lit')      │
│   import.meta.hot  (today)               │   │   sharedState('session')            │
│   getDevToolsRpcClient() (phase 3)       │   │   streaming.subscribe('timeline')   │
└───────────────┬──────────────────────────┘   │   call('inspect-tree' …)            │
                │ HMR channel                  └────────────────┬────────────────────┘
┌───────────────▼──────────────────────────────────────────────▼────────────────────┐
│ Vite dev server + Vite DevTools hub (devframe)                                     │
│  devtools.setup(ctx) → ctx.install(litDevframe)                                    │
│   litDevframe.setup(ctx)  ← framework-neutral                                     │
│     my = ctx.scope('lit')                                                          │
│     my.rpc.sharedState('session')      recording, layer toggles, custom layers    │
│     my.rpc.streaming.create('timeline') event chunks, replayWindow                 │
│     my.rpc.register(inspect-*, get-meta, list-components …)                        │
│     ctx.agent / agent: {…}             MCP tools + resources                       │
│   viteBridge(ctx)          ← Vite-only: server.hot ⇄ TimelineSource                │
└────────────────────────────────────────────────────────────────────────────────────┘
      also runs as:  node bin.mjs dev | build | mcp   (no Vite, source = replay/none)
```

## Layout

```
src/lib/devframe/
  protocol.ts     shared names + payload types; augments DevframeRpcServerFunctions,
                  DevframeRpcClientFunctions, DevframeSettingsRegistry
  definition.ts   defineDevframe({ id: 'lit', … }) — framework-neutral
  source.ts       TimelineSource port (the page-runtime feed) + in-memory impl
  vite.ts         createLitDevframePlugin(): devtools hook + HMR bridge
  paths.ts        package root, version, panel dist dir (layout-independent)
  icon.ts         dock icon (inlined Lit logo data URI)
src/panel/        (phase 2) migrate to connectDevframe; build with Vite to dist/client
bin.mjs           (phase 4) createCac(definition)
```

## Phases

1. **Foundation (done).** `definition.ts`, `protocol.ts`, `source.ts`,
   `vite.ts`, `paths.ts`, `icon.ts`, plus a boot test that runs `setup()`
   through `initDevframe()` in bridge mode. Added `devframe` as a runtime
   dependency.
2. **Wire + panel migration (done).** `timeline: true` mounts
   `createLitDevframePlugin()`; `src/lib/timeline-plugin.ts` and
   `scripts/copy-panel-html.mjs` are deleted along with the SSE, control,
   settings, and inspect endpoints. The panel is a Vite-built SPA in
   `dist/client` talking `connectDevframe()`. The three timeline e2e tests now
   drive the `TimelineSource` port instead of the removed endpoints.
   `/__lit-open-in-editor` and `src/lib/http.ts` survive untouched; swapping
   them for `@devframes/service-open` and dropping `launch-editor` is phase 3.
3. **In-page channel** for pick/highlight so the Components tab works in static
   builds; page runtime dials the hub directly (transport option 2).
4. **Ship anywhere.** `bin.mjs` with `createCac`; `snapshot: true` on
   `get-meta` / `list-components`; document `lit-devtools mcp` for agents.

## What phase 2 changed from the original design

- **No `createPluginFromDevframe()`.** That helper is just
  `{name, devtools: {capabilities, setup: ctx => ctx.install(def, opts)}}`.
  Calling `ctx.install()` directly from our own duck-typed `devtools` hook
  keeps the plugin synchronous, keeps `litPlugin()` returning `Plugin[]`, and
  means `@vitejs/devtools-kit` is never imported at runtime — it is a
  types-only dev dependency. Widening the return type to `PluginOption[]` for
  an async factory would have broken `litPlugin().find(p => p.name === …)`
  for consumers, which the unit tests caught.
- **The timeline stream is started eagerly.** `streaming:subscribe` is
  fire-and-forget on the wire: subscribing to a stream id that does not exist
  yet is dropped with a `DF0030` diagnostic, not queued. Starting the stream
  lazily on the first event meant the panel — which subscribes the moment it
  connects — silently received nothing. Found only by driving the real
  playground; every unit test still passed.
- **`SessionState` has no separate `recording` flag.** `TimelineLayersState`
  already carries `recordingState`, and two copies would need syncing.
- **Dock activation moved to the node side.** `ctx.docks.activate('lit')` when
  a pick arrives, replacing the panel reaching into the parent frame's
  `__VITE_DEVTOOLS_CLIENT_CONTEXT__`.
- **No client-side recording gate.** Every capture layer in the page runtime is
  already gated on the recording flag, so re-checking in the panel would only
  discard the replayed buffer that makes a late-opened panel useful.

## Decisions

- **Scope id `lit`.** RPC ids become `lit:*`, MCP wire names `lit_*`. Short,
  matches the dock title.
- **Streaming, not shared state, for events.** Timeline volume (mouse moves,
  every lifecycle phase) would thrash Immer patches. Streams have bounded
  client queues (`highWaterMark`) and replay; shared state holds only the
  small session snapshot.
- **`jsonSerializable: true` everywhere.** Every payload today is already JSON;
  strict encoding surfaces accidental `Map`/`Element` leaks as coded errors.
- **Agent surface is read-only by default.** Only `type: 'query'` functions get
  `agent`. Inspector actions stay UI-only until there's a use case.
- **Vite-specific code lives only in `vite.ts`.** The definition must run
  under `createDevServer()` with no Vite installed.

## Risks / open questions

- ~~`@vitejs/devtools-kit` becomes an optional peer.~~ Resolved: it is never
  imported at runtime, only used as a types-only dev dependency (see the
  phase-2 notes above).
- The `.pnpm` folder for `@vitejs/devtools@0.7.5` still carries a stale
  `hub@0.8.2` hash; the real symlinks resolve to 1.0.0. Re-check after
  `pnpm install` on a clean clone.
- The static build (`createBuild`) can only bake `snapshot: true` queries; a
  timeline replay needs a recorded session written to `clientAssets`. Out of
  scope until phase 4.
- Streaming `highWaterMark` default 256: a burst of mouse events can drop
  chunks (`DF0029`). Runtime already batches per microtask; keep batches as
  the chunk unit and raise the mark in the panel subscription.
