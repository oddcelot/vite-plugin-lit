# Plan 03: CLI + stdio MCP against the running dev server

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/roadmap/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 2889243..HEAD -- src/lib/devframe/definition.ts src/lib/devframe/vite.ts src/lib/devframe/source.ts src/lib/devframe/paths.ts src/lib/devframe/protocol.ts package.json`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Also re-run the two probes in
> "The central design problem" against whatever version of `@vitejs/devtools`
> / `devframe` is installed at execution time — this plan's central claim
> (the hub does not self-register) is a fact about a specific dependency
> version, not about the devframe protocol, and could change on a bump.

## Status

- **Priority**: P1 (ranked HIGH-impact, #3, in `plans/roadmap/README.md`)
- **Effort**: M
- **Risk**: MEDIUM — the useful half of this plan (instance registration) pokes
  at a constant (`DEVTOOLS_MOUNT_PATH`) and a context shape
  (`ctx.host.resolveOrigin()`) that belong to `@vitejs/devtools-kit` and
  `devframe` respectively, not to a documented "how a plugin registers itself"
  contract. Both are real, exported, and used exactly this way elsewhere in
  the dependency graph (see evidence below), but neither vendor promises this
  specific composition. See STOP conditions.
- **Depends on**: 02 ("Give coding agents the timeline") — not a hard
  blocker for the CLI/MCP plumbing itself, but the more tools plan 02 adds
  before this ships, the more useful the MCP surface is on day one. This plan
  does not touch `TIMELINE_STREAM_*` or add timeline query RPCs; that is 02's
  job.
- **Category**: feature
- **Planned at**: commit `2889243`, 2026-09-17

## Why this matters

`plans/roadmap/README.md` already states the problem plainly:

> Today the MCP endpoint only exists while a Vite dev server with DevTools is
> running, and only over HTTP with an `Origin` header. Until stdio works, 01
> and 02 are reachable in theory more than in practice.

Every mainstream coding-agent MCP client config (`claude_desktop_config.json`,
`claude mcp add`, Cursor's `mcp.json`) is built around spawning a **stdio**
process — `command` + `args` — not dialing an arbitrary HTTP origin with a
custom header. So even though this plugin's three read-only tools
(`lit_get-meta`, `lit_list-components`, `lit_component-details`) are already
live and answering over HTTP the moment a Vite dev server with DevTools starts
(`plans/devframe-foundation.md`, phase 2's "verified end to end" note), no
mainstream agent can point at them today without hand-rolled glue. This plan
is that glue: a `bin.mjs` the plugin ships, wired into `package.json`'s `bin`
field, that a user's MCP client can spawn directly.

## The central design problem

The devframe definition (`src/lib/devframe/definition.ts`) is built around a
`TimelineSource` port (`src/lib/devframe/source.ts:36-45`). Under Vite the
source is `HotTimelineSource` (`src/lib/devframe/vite.ts:95-164`), bridged to
`server.hot` — i.e., to one specific, currently-running page. A bare
`bin.mjs mcp` that constructs `createLitDevframe({source: createNullSource(),
...})` (the module's own default export does exactly this —
`src/lib/devframe/definition.ts:285-288`) attaches to nothing. Concretely:

`src/lib/devframe/definition.ts:104-105` initializes the two caches the query
tools read from:

```ts
let cachedRoots: InspectorTreeNode[] = [];
const cachedDetails = new Map<number, InspectorDetails>();
```

and `src/lib/devframe/definition.ts:110-169` only ever populates them inside
`if (ctx.mode === 'dev')`, by calling `source.attach({... })`
(`:127-158`). `createNullSource()`'s `attach()`
(`src/lib/devframe/source.ts:54-56`) is a no-op that never calls the sink:

```ts
export function createNullSource(): TimelineSource {
  return {
    attach() {
      return () => {};
    },
    ...
```

So `lit_list-components` (`RPC_LIST_COMPONENTS`,
`src/lib/devframe/definition.ts:195-206`) returns `cachedRoots`, which is
`[]` forever, and `lit_component-details` returns `null` for every id. This is
independent of whether `ctx.mode` even resolves to `'dev'` in that runtime —
with a null source it does not matter, because nothing ever calls
`sink.inspectorMessage(...)`. A stdio MCP server that always answers "no
components" is strictly worse than no server: it looks like it's working, and
silently isn't. This confirms the concern from `devframe/dist/adapters/cac.mjs`
(quoted in full under Step 3) — its stock `mcp` subcommand does exactly this
(constructs a fresh, unattached definition per invocation) and must not be
wired to this plugin's default export.

The useful design is for the CLI's `mcp` command to **attach to an
already-running dev server** — the Vite dev server with DevTools, where the
live page and its real `HotTimelineSource` already are — rather than boot a
second, empty instance. The rest of this plan works out whether devframe
supports that, what specifically has to be added, and what to do about the
gap that's left over.

### What was checked: does the hub register itself?

`registerDevframeInstance()` is documented at
`node_modules/devframe/dist/instance-shell-CXnpSuK7.d.mts:54-56`:

> `createDevServer` registers automatically; custom hosts that serve a
> devframe in-process (e.g. `@devframes/next`'s host inside a Next dev server)
> call this explicitly with the origin they are reachable at.

That is confirmed on the `createDevServer` side —
`node_modules/devframe/dist/dev-BTbLJekh.mjs:218-223` hardcodes
`register: true` on every standalone dev server, unconditionally, with the
comment "Publish in the global registry so discovery tooling (`devframe
connect`) finds the server without port guessing."

But this plugin does not go through `createDevServer`. It mounts into the
**Vite DevTools hub** via `ctx.install(definition)`
(`src/lib/devframe/vite.ts:189-211`), where `ctx` is supplied by
`@vitejs/devtools`, not by this plugin. Tracing that hub's construction:

`@vitejs/devtools@0.7.5`'s `createDevToolsHub()`
(`node_modules/.pnpm/@vitejs+devtools@0.7.5.../dist/server-BIAKwFxh.js:138-149`):

```js
const hub = initHub({
  base: DEVTOOLS_MOUNT_PATH,
  context,
  ui: createViteDevToolsUi(options.ui),
  renderers: resolveDockRendererRegistrations(options.renderers),
  ...(context.viteServer ? {clientModuleResolution: '/@id/{specifier}'} : {}),
  auth: authDisabled ? false : getAuthHandler(context),
  ...(allowedOrigins ? {allowedOrigins} : {}),
  ...(mcp !== void 0 ? {mcp} : {}),
  ...(options.server
    ? {server: options.server}
    : {ws: options.wsPort != null ? {port: options.wsPort} : {sidecar: true}}),
  ...(options.host ? {host: options.host} : {}),
});
```

No `register` key. `initHub()`'s own type
(`node_modules/.pnpm/@devframes+hub@1.0.0.../dist/node/initiate.d.mts:226-235`)
documents the option it's missing:

> Publish this hub in the global instance registry (`~/.devframe/instances/`)
> so discovery tooling (`devframe connect`, the inspect plugin's Instances
> tab) lists it like any standalone devframe. ... **Defaults to off**; pass
> `true` to enable, or an object to override individual record fields.

A grep for `Instance` across the entire compiled `@vitejs/devtools` `dist/`
returns nothing. **Conclusion: the Vite DevTools hub, as shipped in the
version this repo depends on (`package.json:61,81`, pinned to `0.7.5`), does
not self-register.** `listLiveDevframeInstances()` will never see it, with no
action from this plugin.

Contrast with `@devframes/vite`'s _own_ hub-mounting plugin (a different,
lower-level integration this repo does not use —
`viteDevframeHub()` in `node_modules/.pnpm/@devframes+vite@1.0.0.../dist/hub.mjs:81-92`),
which forwards a caller-supplied `register` straight through:

```js
...pickDefined(options, [
    "host", "renderers", "rpcDeclarations", "mcp",
    "register", "getStorageDir", "name", "version", "configure"
])
```

confirming `register` is a real, first-class `initHub()` option — just one
`@vitejs/devtools` doesn't set.

### What was checked: can a stdio process proxy a running instance?

Yes, and devframe ships exactly this, following a credited prior-art
architecture. `@devframes/agentic/connect` exports `startConnectServer()`
(`node_modules/.pnpm/@devframes+agentic@1.0.0.../dist/connect/index.d.mts:47-57`):

> Start the devframe MCP connector on stdio: a thin discovery + proxy server
> in the shape Vercel's next-devtools-mcp
> (https://github.com/vercel/next-devtools-mcp) validated ... It exposes two
> gateway tools: `devframe_connect_list-instances` (discover running devframe
> instances via the instance registry and list each one's MCP tools) and
> `devframe_connect_call-tool` (invoke one tool on one instance over its
> Streamable-HTTP endpoint), and holds no domain knowledge of its own.

Reading the real implementation
(`node_modules/.pnpm/@devframes+agentic@1.0.0.../dist/connect/index.mjs`), two
discovery paths feed it (`index()`, lines 102–142):

1. `listLiveDevframeInstances()` — the registry. Empty for us today, per above.
2. An explicit `options.ports` list, each probed by `probePort()`
   (lines 148–162):

   ```js
   async function probePort(port, timeoutMs) {
   	const probed = await probeDevframeOrigin(`http://localhost:${port}`, "/", timeoutMs);
   	...
   ```

   `basePath` is **hardcoded to `"/"`**. Our devframe is hosted under
   `/__devtools/` (`DEVTOOLS_MOUNT_PATH`, see below), so the port-probe
   fallback cannot find it either — it will fetch
   `http://localhost:<port>/__connection.json`, which 404s (or hits the app's
   own root), not `http://localhost:<port>/__devtools/__connection.json`.

So today, **neither discovery path in devframe's own generic connector can
reach a devframe hosted inside the Vite DevTools hub.** This is not a defect
in `startConnectServer()` — it does exactly what it documents — it is a gap in
how `@vitejs/devtools` composes `initHub()`.

### The fix this plan proposes, and its honest limits

`registerDevframeInstance()` is a public, standalone function
(`node_modules/devframe/dist/instance-shell-CXnpSuK7.d.mts:64-66`) that any
in-process host may call directly — its own docstring invites exactly this
("custom hosts ... call this explicitly with the origin they are reachable
at"). Nothing stops this plugin from calling it itself from
`createLitDevframePlugin()`'s `devtools.setup(ctx)`
(`src/lib/devframe/vite.ts:189-211`), independent of whatever `@vitejs/devtools`
does or doesn't opt into on `initHub()`. The registry is a directory of JSON
files; multiple registrants coexist.

What the record needs, and where each field comes from:

| Field                   | Source                                                                                                                                                                                                                                                                                                                                                                                               | Confidence                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pid`                   | `process.pid`                                                                                                                                                                                                                                                                                                                                                                                        | certain                                                                                                                                            |
| `port`                  | `ctx.viteServer.config.server.port` (already available — `vite.ts:193` already reads `ctx.viteServer`)                                                                                                                                                                                                                                                                                               | certain                                                                                                                                            |
| `origin`                | `ctx.host.resolveOrigin()` — declared on `DevframeHost`, `node_modules/devframe/dist/context--tVkJw3W.d.mts:466-472`: _"Return the public origin the host is reachable at, e.g. `http://localhost:5173`."_ `DevframeHubContext extends DevframeNodeContext` (`.../context-DaUV_lYb.d.mts:506-507`), so `ctx.host` is reachable from the hub context our `devtools.setup(ctx)` hook already receives. | high — documented, generic across hosts                                                                                                            |
| `basePath`              | `DEVTOOLS_MOUNT_PATH` from `@vitejs/devtools-kit/constants`, confirmed `"/__devtools/"` at `node_modules/.pnpm/@vitejs+devtools-kit@0.7.5.../dist/constants.d.ts:5`                                                                                                                                                                                                                                  | **medium** — correct for `@vitejs/devtools@0.7.5` today; not a contract that this mount path is stable, or that some other future hub host uses it |
| `mcp.path`              | `${DEVTOOLS_MOUNT_PATH}__mcp` — `__mcp` is `McpRouteOptions.path`'s documented default (`context--tVkJw3W.d.mts:1249-1252`), and `initiate.d.mts:209-218` documents the hub's own route as "the **aggregate** MCP endpoint at `<base>__mcp`"                                                                                                                                                         | medium — same caveat as basePath, plus depends on the hub actually mounting the route (see below)                                                  |
| `id`, `name`, `rootDir` | `LIT_DEVFRAME_ID`, the definition's `name`, `process.cwd()`                                                                                                                                                                                                                                                                                                                                          | certain                                                                                                                                            |

Two things make this MEDIUM risk rather than a clean fix, and both must be
called out to whoever reviews the eventual PR, not discovered later:

1. **It hardcodes a constant from a peer package's implementation, not its
   public contract.** `DEVTOOLS_MOUNT_PATH` is exported and stable across
   `0.7.x` (confirmed in this repo's own dependency tree), but nothing commits
   `@vitejs/devtools` to keeping devframes it hosts at that exact base forever,
   and a _different_ devframe-hosting integration (a hypothetical Nuxt
   DevTools, or `@devframes/vite`'s `viteDevframeHub()` used directly instead
   of `@vitejs/devtools`) would use a different base entirely. **Mitigation
   this plan requires**: register only after a self-probe confirms the guess.
   Call `probeDevframeOrigin(origin, basePath)` (same function the registry
   itself uses for liveness) right after computing the candidate record; only
   call `registerDevframeInstance()` if the probe succeeds and its
   `meta.mcp?.path` roundtrips. If the probe fails, log a single
   `console.warn` (not a thrown error — the panel and every RPC must keep
   working with no MCP discovery) and skip registration. This turns a
   guessed constant into a verified fact before publishing it, and stays inert
   (no-op) the day the guess stops matching reality instead of publishing a
   record that returns 404s to the agent it lied to.
2. **Multiple registrants sharing one `pid`+`port` file.** Records are written
   to `<dir>/<pid>-<port>.json`, keyed by pid+port only
   (`instance-shell-CXnpSuK7.d.mts:58`). If another tool in the same Vite
   process (a different devframe-hosting plugin) also registers against the
   same port, whichever one's `unregister()` fires first on its own teardown
   deletes the file the other still wants live. This plugin's own teardown
   (`viteServer.httpServer.once('close', ...)`, following the existing pattern
   at `src/lib/devframe/vite.ts` is where this would hook in) is the only
   `unregister()` call this plugin controls; there is no cross-plugin
   coordination primitive today. Acceptable for now (single-devframe use is
   the common case), but record it as a known sharp edge rather than
   discovering it later as a flaky bug report.

If the self-probe in mitigation (1) never succeeds in practice (e.g., a future
`@vitejs/devtools` release changes its mount convention, or gates
`__connection.json` behind auth this plugin can't present), **registration
silently does nothing** — which is the correct failure mode. It must never be
allowed to register a record that doesn't actually answer.

## What ships even if the registration step above never lands

Regardless of whether Step 2 (below) proves out, one fact does not depend on
it: the hub's aggregate MCP route is _already live today_ — `plans/devframe
-foundation.md` records "three read-only MCP tools answering" as verified in
the playground, and `plans/roadmap/README.md` independently confirms "the MCP
endpoint only exists while a Vite dev server with DevTools is running... over
HTTP". So the origin+path is knowable **by convention** even with zero new
plugin code: `http://<host>:<port><DEVTOOLS_MOUNT_PATH>__mcp`, e.g.
`http://localhost:5179/__devtools/__mcp` for this repo's playground
(`playground/vite.config.ts:27`, default port `5179`).

Any general-purpose stdio↔HTTP MCP bridge can front that URL. The most widely
used is **`mcp-remote`** (published on npm, used across the MCP ecosystem
specifically to bridge stdio-only clients to Streamable-HTTP/SSE servers). A
user can wire this up **today, with no change to this package at all**:

```json
{
  "mcpServers": {
    "lit-devtools": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:5179/__devtools/__mcp"]
    }
  }
}
```

or, via the Claude Code CLI:

```sh
claude mcp add lit-devtools -- npx -y mcp-remote http://localhost:5179/__devtools/__mcp
```

This is the **documented fallback and the thing to ship first** (Step 1,
below) — it requires no code, works against the version already in this
repo's lockfile, and gives agents real, live data immediately. Everything
after Step 1 is a strictly nicer version of the same access path: a
project-specific `bin`, auto-discovery instead of a hand-typed port, and no
dependency on a second npm package at request time.

## Current state

`src/lib/devframe/definition.ts:285-288` (the module's own default export —
do not point a CLI at this unmodified):

```ts
export default createLitDevframe({
  source: createNullSource(),
  version: '0.0.0',
});
```

`src/lib/devframe/paths.ts:38-46` already resolves the package root and
version robustly across the source/build layout split — the CLI's own
`createLitDevframe({..., version: PACKAGE_VERSION})` construction should reuse
`PACKAGE_VERSION` from here rather than hardcoding `'0.0.0'` like the default
export does.

`package.json` today has no `bin` field, no `cac` dependency, and no
`@devframes/agentic` dependency (`package.json:54-88`, quoted in full under
"Why this matters" investigation above). `devframe` itself declares both as
**optional peers** (`node_modules/devframe/package.json`, `peerDependencies:
{"@devframes/agentic": "1.0.0", "cac": "^7.0.0"}`, both listed again under
`peerDependenciesMeta` with `optional: true`), matching the existing pattern
this repo already uses for `@vitejs/devtools-kit`
(`package.json:60-72`).

## Implementation steps

### Step 1 (ship first, zero code): document the `mcp-remote` path

Add a short section to `README.md` (near the existing DevTools documentation)
covering the `claude_desktop_config.json` / `claude mcp add` snippets above,
stated as the way to reach the three (or more, once plan 02 lands) live
`lit_*` tools **today**, while the dev server is running with DevTools
enabled. State explicitly that this depends on the dev server actually being
up (agents get a connection error otherwise, not stale data — there is no
data to be stale) and that the port must match whatever the user's Vite
config resolves to.

**Verify**: the README change reads correctly; no code changes, so no build
step applies.

### Step 2: `registerDevframeInstance()` from the Vite plugin, with a

verifying self-probe

In `src/lib/devframe/vite.ts`, inside `createLitDevframePlugin()`'s
`devtools.setup(ctx)` (`:189-211`), after `await ctx.install(definition)`
succeeds:

1. Compute the candidate origin via `ctx.host.resolveOrigin()` (widen the
   locally-declared `DevToolsHubContext` interface, `vite.ts:58-67`, to
   include `host: {resolveOrigin(): string}` — structurally, matching
   `DevframeHost` rather than importing devframe's node-context types
   directly, following the same "declared here so the package never imports
   that optional peer at runtime" convention already used for the rest of
   `DevToolsHubContext`).
2. Import `DEVTOOLS_MOUNT_PATH` from `@vitejs/devtools-kit/constants` — this
   makes `@vitejs/devtools-kit` a real (still-optional) import, so gate the
   whole registration attempt behind a dynamic `import('@vitejs/devtools-kit/constants').catch(() => null)`,
   never a static top-level import, so a consumer running the plugin with the
   DevTools peer absent (already a supported configuration —
   `peerDependenciesMeta` marks it optional) never fails to resolve a module.
3. Build the candidate `basePath` and `mcp.path` as described in the table
   above.
4. Dynamically import `probeDevframeOrigin` from `devframe/internal` (check
   this subpath actually resolves from the `devframe` version pinned in
   `package.json:55` before relying on it — `connect/index.mjs`'s own import
   line, `import { ... probeDevframeOrigin } from "devframe/internal"`, is
   the evidence it's a real public subpath) and call it with the candidate
   origin/basePath. Proceed only on a truthy result whose `meta.mcp?.path`
   matches the computed `mcp.path`.
5. On success, dynamically import `registerDevframeInstance` (same
   `devframe/internal` subpath) and call it with the assembled
   `DevframeInstanceRecord`. Store the returned
   `DevframeInstanceRegistration.unregister` and call it from the same
   teardown path `HotTimelineSource` already needs (this plugin currently has
   no explicit teardown hook — add one via `server.httpServer?.once('close',
...)`, mirroring the pattern already used by `@devframes/vite`'s
   `viteDevframeHub()`, `hub.mjs:96-99`).
6. On any failure at any step (module not resolvable, probe fails, mismatch),
   `console.warn` **once** with a clear "stdio/registry discovery unavailable,
   falling back to direct MCP URL" message pointing at the Step 1 URL
   convention, and continue — never throw, never affect the panel or RPCs.

This step is the one most likely to need rework; see STOP conditions.

**Verify**:

- `pnpm exec vp check` → exit 0.
- Manual: `pnpm run dev` (playground on `:5179`), then in a second terminal,
  `cat ~/.devframe/instances/*.json` (or `$DEVFRAME_INSTANCES_DIR` if set) and
  confirm exactly one record exists with `port: 5179`, `basePath:
"/__devtools/"`, and `mcp.path` ending in `__mcp`. Stop the dev server and
  confirm the file is removed.

### Step 3: `bin.mjs` — `dev` / `build` / `mcp`

Add `bin/lit-devtools.mjs` (or `bin.mjs` at the package root — match whichever
convention `PACKAGE_ROOT` resolution in `src/lib/devframe/paths.ts` makes
simplest to keep working from both the source tree and the published
`lib/` layout).

Do **not** call `createCac(definition)` unmodified and ship its default `mcp`
subcommand. That subcommand is devframe's own, generic implementation
(`node_modules/devframe/dist/adapters/cac.mjs:127-136`):

```js
cli
  .command('mcp', 'Start an MCP server exposing agent-facing tools (stdio)')
  .action(async () => {
    const {createMcpServer} = await importAgenticMcp();
    await createMcpServer(d, {
      transport: 'stdio',
      onReady: ({transport}) => {
        console.error(`[devframe] "${d.id}" MCP server ready (${transport})`);
      },
    });
  });
```

`createMcpServer(d, ...)` runs `d.setup(ctx)` fresh, in-process, with whatever
`source` `d` was built with. Since this file's `createLitDevframe(...)` call
has no page to attach (no Vite, no dev server, no `HotTimelineSource`), this
is exactly the "always answers empty" trap from "The central design problem."
**Do not wire this command up.**

Instead:

1. Build the CLI by hand (or with `createCac`, but override its `mcp`
   subcommand — check whether `CacHandle.cli` (`CreateCacOptions`'s return
   type, `cac.d.mts:34-41`) exposes enough of the raw `cac` instance to
   re-register/overwrite the `mcp` command id; if `cac` the library doesn't
   support overwriting a registered command cleanly, build the CLI from
   scratch with a bare `cac()` instance instead of going through
   `createCac()` at all — simpler and removes the risk of fighting the
   wrapper).
2. `dev` subcommand → `createDevServer(definition, {...})` from
   `devframe/adapters/dev`, using `createLitDevframe({source:
createNullSource(), version: PACKAGE_VERSION})`. This is a legitimate,
   standalone, page-less dev server — see "What standalone `dev` is for"
   below for what it actually buys today.
3. `build` subcommand → out of scope for this plan; `plans/roadmap/README.md`
   already tracks this as plan 08 ("Static snapshot for bug reports"), which
   depends on plan 02's event buffer. Register the subcommand as a stub that
   prints "not yet implemented — see plans/roadmap/README.md #08" rather than
   silently producing a build with only `get-meta`'s snapshot baked in (the
   only RPC with `snapshot: true` today,
   `src/lib/devframe/definition.ts:176`).
4. `mcp` subcommand → call `startConnectServer()` from
   `@devframes/agentic/connect` directly, with no arguments (it needs none —
   it is generic across every devframe on the machine, not specific to
   `lit`). Accept a `--port <n>` CLI flag that forwards into
   `startConnectServer({ports: [n]})` for the case where Step 2's
   registration didn't land or didn't fire (dev server started before this
   plugin version, or the self-probe declined to register) — this reuses
   `startConnectServer`'s own documented port-probe path, with the caveat
   from the earlier investigation that the probe assumes `basePath: "/"`, so
   `--port` only helps for a **root-mounted** standalone instance (this
   file's own `dev` subcommand, from Step 3.2), not for a Vite-hosted one.
   State this caveat in the command's `--help` text, not just in a doc file
   nobody reads before typing the command.

**Note on scope**: this makes `bin.mjs mcp` a thin wrapper around devframe's
own generic connector, not a `lit`-specific MCP server. That is an accurate
reflection of the architecture (one connector discovers every devframe on the
machine) and should be stated as such in the command's description, not
presented as if it only surfaces Lit tools.

Add to `package.json`:

```json
"bin": {
  "lit-devtools": "./bin.mjs"
},
```

and add `cac` + `@devframes/agentic` to `peerDependencies` /
`peerDependenciesMeta` (both `optional: true`), matching the existing
`@vitejs/devtools-kit` entry (`package.json:60-72`). Add both to
`devDependencies` too, pinned the same way `@vitejs/devtools-kit` is
(`package.json:81`), so `vp check` / unit tests exercise the real modules.

**Verify**:

- `pnpm install` after the `package.json` edit → exit 0.
- `pnpm exec vp check` → exit 0.
- `node bin.mjs --help` lists `dev`, `build`, `mcp`.
- `node bin.mjs mcp` started against a **stopped** dev server, then sending a
  `tools/list` JSON-RPC frame over stdin, returns the two gateway tools
  (`devframe_connect_list-instances`, `devframe_connect_call-tool`) and, when
  `devframe_connect_list-instances` is called, reports zero instances with the
  connector's own "No running devframe instances found" hint (confirms the
  wrapper is wired correctly, without requiring Step 2 to have landed).
- With the playground dev server running (`pnpm run dev`) **and** Step 2
  landed, re-run `devframe_connect_list-instances` through `node bin.mjs mcp`
  and confirm it lists the `lit` instance with a non-empty `tools` array
  including `lit_get-meta`.

### Step 4: `cli` field on the definition

`DevframeDefinition.cli` (`context--tVkJw3W.d.mts:1547`, type
`DevframeCliOptions` at `:1279-1365`) lets the definition itself contribute
CLI metadata consumed by `createCac()` — `command` (binary name, defaults to
`d.id` i.e. `"lit"`), default `port`/`host`, and a `configure(cli)` hook for
definition-owned flags. Since Step 3 deliberately does not go through
`createCac()` for the `mcp` command, decide during implementation whether it's
worth going through `createCac()` for `dev`/`build` alone (gaining the
`cli.flags` / `--port` / `--host` machinery for free) and only hand-rolling
`mcp`, versus a fully hand-rolled CLI for consistency. Lean toward the
`createCac()` hybrid if `cli.runMatchedCommand()`
(`cac.mjs:141-147`) and manual command registration don't fight each other in
practice — check by registering an extra `cli.command('mcp', ...)` **before**
calling `createCac()`'s own registration would run, since `cac` typically
resolves commands by the order they're defined and only chooses one; validate
this empirically before committing to the approach in the PR.

Set `cli: {command: 'lit-devtools', port: 5179}` on the `createLitDevframe(...)`
call this new `bin.mjs` uses (matching the playground's own default so the
two don't collide when a developer runs both `pnpm run dev` and `node bin.mjs
dev` against the same playground checkout — pick different literal defaults if
this is confusing to explain rather than colliding two "5179"s; state whichever
choice is made and why in the PR).

**Verify**: `pnpm exec vp check` → exit 0.

### Step 5: worked MCP client config

Add to the README (near the Step 1 snippet, updated once `bin.mjs` exists):

```json
{
  "mcpServers": {
    "lit-devtools": {
      "command": "npx",
      "args": ["-y", "@oddsquad/vite-plugin-lit", "mcp"]
    }
  }
}
```

and the Claude Code equivalent:

```sh
claude mcp add lit-devtools -- npx -y @oddsquad/vite-plugin-lit mcp
```

State plainly in the surrounding prose: this only surfaces something useful
while a Vite dev server with DevTools is _also_ running, and, until Step 2's
registration self-probe is confirmed reliable in the field, the `mcp-remote`
URL form from Step 1 is the more dependable path. Do not present the `bin.mjs
mcp` command as strictly superior without that caveat — it depends on
discovery machinery this plan explicitly could not fully verify (see STOP
conditions).

**Verify**: both snippets are valid JSON / shell; no automated check applies.

## What standalone `dev` is genuinely for

Worth stating honestly rather than implying more value than exists: this
plugin's users are on Vite **by definition** — it is a Vite plugin for Lit's
HMR. A standalone `bin.mjs dev` with `createNullSource()` cannot show a real
component tree today; the page-runtime dial-home that would fix that
(`plans/devframe-foundation.md`'s "option 2", `getDevToolsRpcClient()`) is
explicitly deferred to a later phase and is not part of this plan. So today,
standalone `dev` is:

- A correctness harness: it proves the definition really is framework-neutral
  (the whole premise of `src/lib/devframe/definition.ts` having no Vite
  import), which is worth having for its own sake and for CI.
- The literal foundation plan 10 (Nuxt and Next adapters,
  `plans/roadmap/README.md`) needs — those adapters mount the same
  `DevframeDefinition` into a different host's dev server, and standalone
  `dev` is the first proof that hosting works with no Vite in the loop.
- Not, today, a way for a Lit developer to get live component data without
  Vite running. If that turns out to matter, it is a "option 2" transport
  problem (page dials the hub directly), not a CLI problem, and belongs in
  its own plan once phase 3 of `plans/devframe-foundation.md` lands.

State this in the README section from Step 1/5 rather than let a user
discover it by running `dev` and finding an empty panel.

## Verification

Full gate, once all steps land:

- `pnpm install` → exit 0
- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0
- `pnpm run build` → exit 0
- `node bin.mjs --help` shows `dev`, `build`, `mcp`
- `node bin.mjs mcp` answers `tools/list` over stdio (works with or without a
  live dev server; content differs, never errors)
- With `pnpm run dev` running: the manual registry check from Step 2, and the
  manual `devframe_connect_list-instances` check from Step 3, both pass
- `git status --porcelain` shows only the files this plan touches:
  `src/lib/devframe/vite.ts`, `bin.mjs` (or `bin/lit-devtools.mjs`),
  `package.json`, `pnpm-lock.yaml`, `README.md`, plus
  `plans/roadmap/README.md`'s status row

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `src/lib/devframe/definition.ts`, `vite.ts`,
  `source.ts`, or `protocol.ts` changed in a way that invalidates the quoted
  excerpts (e.g. `TimelineSource` gains new required methods, or `ctx.mode`
  gains a third value).
- Re-running the two probes under "The central design problem" against the
  currently-installed `@vitejs/devtools` / `devframe` versions produces
  different results than quoted here (e.g. a newer `@vitejs/devtools` _does_
  pass `register` to `initHub()`, or `startConnectServer()`'s port probe
  gains a `basePath` option). Either would simplify this plan considerably —
  report it rather than building around a problem that's already been fixed
  upstream.
- The Step 2 self-probe (`probeDevframeOrigin` against the guessed
  `/__devtools/` base) fails in the manual verification even once, in a clean
  playground run. That means the base-path guess is wrong for the installed
  version, and registration must not proceed silently — do not loosen the
  probe's matching criteria to force a "success"; report the actual mismatch.
- `createCac()`'s command registration cannot be cleanly partially overridden
  (Step 4) and the resulting hand-rolled hybrid feels like fighting the
  library more than using it — stop and propose a fully hand-rolled CLI
  instead of forcing the wrapper.
- Any step requires making `@vitejs/devtools-kit`, `cac`, or
  `@devframes/agentic` a **non-optional** dependency of this package. All
  three must stay optional peers, consistent with the existing pattern
  (`package.json:66-72`) and with this plugin working with DevTools absent.
