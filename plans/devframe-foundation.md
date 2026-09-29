# Lit DevTools on Devframe

The DevTools panel is a [Devframe](https://devfra.me) definition, not a bespoke
Vite integration. Vite DevTools is itself built on Devframe, so the host already
runs RPC, shared state, streaming, auth and MCP. The same definition runs
mounted in the Vite DevTools hub, as a standalone dev server
(`lit-devtools dev`), as a static snapshot, and as an MCP server for coding
agents.

An earlier version shipped its own transport: an SSE endpoint, several `POST`
middlewares, a hand-rolled origin check and a set of `server.hot` channel names.
Devframe replaced all of it.

## Shape

- **Definition** (`src/lib/devframe/definition.ts`):
  `defineDevframe({id: 'lit', ...})`. It is framework-neutral and imports
  nothing from Vite. It must keep running under `createDevServer()` with no Vite
  installed.
- **Protocol** (`src/lib/devframe/protocol.ts`): RPC names, payload types and
  the augmentations of Devframe's registries.
- **Source port** (`src/lib/devframe/source.ts`): `TimelineSource` is the seam
  to the inspected page. Vite supplies a source bridged to `server.hot`. The
  standalone CLI supplies one backed by RPC (`src/lib/devframe/rpc-source.ts`).
  Snapshots and tests supply a null source.
- **Vite host** (`src/lib/devframe/vite.ts`): the only file that knows about
  Vite. It mounts the definition from a duck-typed `devtools.setup(ctx)` hook
  and bridges the page's HMR channels to the source.
- **Panel** (`src/panel/`): a Lit SPA built with Vite into `dist/client`, served
  by the hub at `/__lit/`, talking through `connectDevframe().scope('lit')`.

## Decisions

- **Scope id `lit`.** RPC ids become `lit:*` and MCP tool names `lit_*`. It is
  short and matches the dock title.
- **The plugin calls `ctx.install(definition)` itself instead of using
  `createPluginFromDevframe()`.** That helper only wraps
  `{name, devtools: {setup: ctx => ctx.install(def)}}`. Calling it directly
  keeps `litPlugin()` synchronous and returning a plain `Plugin[]`. Widening the
  type to `PluginOption[]` for an async factory would have broken
  `litPlugin().find(p => p.name === ...)` for consumers. It also means
  `@vitejs/devtools-kit` is never imported at runtime, only used for types.
- **Page runtime keeps `import.meta.hot`, bridged in the Vite host.** The
  alternative is a page that dials the hub itself with `getDevToolsRpcClient()`.
  That was rejected first for risk, since it would have rewritten the runtime
  and its e2e fixtures. The `TimelineSource` port is what later let the
  dial-home transport land (see `devtools-features.md`).
- **Events go over a stream, state over shared state.** Timeline volume (mouse
  moves, every lifecycle phase) would thrash Immer patches in shared state.
  Streams have bounded client queues and replay. Shared state holds only the
  small `session` snapshot (layer toggles and custom layers). Recording is not a
  separate flag: `TimelineLayersState` already carries `recordingState`, and two
  copies would need syncing.
- **The timeline stream is created eagerly in `setup()`.** `streaming:subscribe`
  is fire-and-forget on the wire. Subscribing to a stream id that does not exist
  yet is dropped with a `DF0030` diagnostic, not queued. Creating the stream
  lazily on the first event left a panel that subscribes on connect silently
  receiving nothing. Every unit test passed; only driving the real playground
  found it.
- **Batches are the chunk unit.** The default `highWaterMark` of 256 can drop
  chunks (`DF0029`) under a burst of mouse events. The runtime already batches
  per microtask, so the panel raises the mark on its subscription
  (`src/panel/timeline-store.ts`).
- **No client-side recording gate.** Every capture layer in the page is already
  gated on the recording flag. Re-checking in the panel would discard the
  replayed buffer that makes a late-opened panel useful.
- **`jsonSerializable: true` on every function.** Payloads are already JSON.
  Strict encoding turns an accidental `Map` or `Element` leak into a coded
  error.
- **Agents get read-only queries, plus recording.** Only `type: 'query'`
  functions carry `agent`. Mutating actions (`inspect`, `toggle-layer`,
  `set-settings-override`, `open-source`, `export-snapshot`) stay panel-only, so
  an agent cannot retarget the picker, change settings, spawn an editor or write
  to disk behind the developer's back. `set-recording` is the one exception,
  because reading the timeline is useless while recording is off.
- **The dock is activated from node.** `ctx.docks.activate('lit', params)`
  replaces the panel reaching into the parent frame's
  `__VITE_DEVTOOLS_CLIENT_CONTEXT__`.
- **Trust is Devframe's handshake.** Localhost bind, bearer token and
  `ensureTrusted()` replace the old hand-written origin check. Do not set
  `auth: false` outside local playgrounds.
- **Not built: a JSON-render UI, cross-devframe services.** JSON-render would
  give up the design system and the domain-specific views (timeline, component
  tree) for nothing this tool needs. Publishing Lit data as a `ctx.services`
  capability has no consumer.

## Gotchas

- The hub's `/__devtools/__mcp` returns 403 without an `Origin` header, and the
  panel SPA lives at `/__lit/`.
- A static build can only bake `snapshot: true` queries. A timeline replay needs
  the session written into the build, which is what `src/lib/snapshot.ts` does.
- The hub, not this package, installs `@devframes/service-open` (see
  `devtools-features.md`).
