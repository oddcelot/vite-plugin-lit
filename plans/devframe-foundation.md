# Plan: Lit DevTools on Devframe

Status: **phase 1 done** — `src/lib/devframe/{protocol,source,definition,vite}.ts`
plus a boot test (`src/test/unit/devframe_test.ts`) that runs `setup()` through
`initDevframe()` in bridge mode. Not yet wired into `litPlugin()`.
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

| Today (bespoke)                                                      | Devframe primitive                                                                                                  | Notes                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ctx.docks.register({type:'iframe', url: PANEL_PATH})`               | `defineDevframe({ id: 'lit', clientAssets, dock })` + `createPluginFromDevframe()` from `@vitejs/devtools-kit/node` | Hub mounts the SPA at `/.lit/` and registers the dock. No manual middleware.                    |
| `GET /__lit-devtools-events` (SSE, `TimelineEvent[]` batches)        | `ctx.rpc.streaming.create('timeline', { replayWindow })`                                                            | Chunk feed with replay on reconnect. One channel, one stream per recording session.             |
| `GET /__lit-devtools-events` `event: layer` / `event: inspect`       | Shared state (`layers`) / `ctx.rpc.broadcast()` to a client function                                                | Layers are a snapshot; inspector messages are transient pushes.                                 |
| `POST /__lit-devtools-control` (recording, layer toggles)            | Shared state `session` `{ recording, layers }`, mutated from the panel                                              | Survives reconnect; every surface (panel, runtime, MCP) reads one authority.                    |
| `GET/POST /__lit-devtools-settings` + `localStorage` override        | `my.settings.project` / `my.settings.global` via `ctx.scope('lit')`                                                 | File-backed, synced to peers, typed through `DevframeSettingsRegistry`.                         |
| `POST /__lit-devtools-inspect` → `server.hot.send(INSPECT_CMD)`      | `type: 'action'` RPC functions (`inspect-tree`, `inspect-details`, `inspect-highlight`, `inspect-pick`)             | Node forwards to the page runtime (see transport below).                                        |
| `GET /__lit-open-in-editor` + `launch-editor`                        | `@devframes/service-open` (`ctx.services.get('@devframes/service-open')`)                                           | Path containment + known-editor picklist. Drop `launch-editor` dep once migrated.               |
| `isTrustedRequest()` origin check                                    | Devframe trust handshake (localhost bind, bearer token, `ensureTrusted()`)                                          | Never set `auth: false` outside local playgrounds.                                              |
| `window.parent.__VITE_DEVTOOLS_CLIENT_CONTEXT__.docks.switchEntry()` | `ctx.docks.activate('lit')` from node, or `getDevframeClientContext().docks` in a client script                     | No reaching into the parent frame.                                                              |
| panel → `fetch()` + `EventSource`                                    | `connectDevframe().scope('lit')` → `rpc.call`, `rpc.sharedState`, `rpc.streaming.subscribe`                         | One WS connection, typed.                                                                       |
| n/a                                                                  | `agent: { description, safety }` on query RPCs + `ctx.agent.registerResource()`                                     | Coding agents get `lit_list_components`, `lit_component_details`, `lit_timeline_summary` tools. |

### Page runtime ↔ node transport

The inspected app's page is the one surface Devframe does not own. Two options:

1. **Keep `import.meta.hot` for the page runtime, bridge in the Vite host
   `setup()`.** `createPluginFromDevframe(def, { setup(ctx) })` runs with
   `ctx.viteServer`. The Vite-specific `setup` subscribes to
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

## Architecture (target)

```
┌── app page ──────────────────────────────┐   ┌── panel iframe (/.lit/) ────────────┐
│ runtime/timeline/install.ts              │   │ Lit SPA, built with Vite, base './' │
│ runtime/inspector/install.ts             │   │ connectDevframe().scope('lit')      │
│   import.meta.hot  (phase 1)             │   │   sharedState('session')            │
│   getDevToolsRpcClient() (phase 2)       │   │   streaming.subscribe('timeline')   │
└───────────────┬──────────────────────────┘   │   call('inspect-tree' …)            │
                │ HMR channel                  └────────────────┬────────────────────┘
┌───────────────▼──────────────────────────────────────────────▼────────────────────┐
│ Vite dev server + Vite DevTools hub (devframe)                                     │
│  createPluginFromDevframe(litDevframe, { setup: viteBridge })                      │
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
  vite.ts         createLitDevframePlugin(): createPluginFromDevframe + HMR bridge
src/panel/        (phase 2) migrate to connectDevframe; build with Vite to dist/client
bin.mjs           (phase 4) createCac(definition)
```

## Phases

1. **Foundation (this plan, scaffolded).** `definition.ts`, `protocol.ts`,
   `source.ts`, `vite.ts`. Not yet reachable from `litPlugin()`.
   Dependencies added: `devframe` (runtime), `@vitejs/devtools-kit` (optional
   peer, dynamic import), `@devframes/service-open` (dev, for the playground).
2. **Wire + panel migration.** `timeline: true` mounts `createLitDevframePlugin()`
   instead of `litTimelinePlugin()`. Panel talks over `connectDevframe`; build
   panel with Vite into `dist/client`, `clientAssets` points there. Delete SSE,
   control, settings, inspect endpoints. Keep `/__lit-open-in-editor` until the
   open service is proven, then remove `launch-editor`.
3. **In-page channel** for pick/highlight so the Components tab works in static
   builds; page runtime dials the hub directly (transport option 2).
4. **Ship anywhere.** `bin.mjs` with `createCac`; `snapshot: true` on
   `get-meta` / `list-components`; document `lit-devtools mcp` for agents.

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

- `@vitejs/devtools-kit` becomes an optional peer. Today the plugin avoids it
  by duck-typing; `createPluginFromDevframe` needs the real import. Load it
  lazily so `litPlugin()` without `timeline` never touches it.
- The `.pnpm` folder for `@vitejs/devtools@0.7.5` still carries a stale
  `hub@0.8.2` hash; the real symlinks resolve to 1.0.0. Re-check after
  `pnpm install` on a clean clone.
- The static build (`createBuild`) can only bake `snapshot: true` queries; a
  timeline replay needs a recorded session written to `clientAssets`. Out of
  scope until phase 4.
- Streaming `highWaterMark` default 256: a burst of mouse events can drop
  chunks (`DF0029`). Runtime already batches per microtask; keep batches as
  the chunk unit and raise the mark in the panel subscription.
