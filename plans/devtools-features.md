# DevTools features built on Devframe

Design rationale for the features layered on the Devframe foundation
(`devframe-foundation.md`) and the capture layer (`devtools-timeline.md`):
reload diagnostics, agent access, the update explainer, the CLI and MCP, the
in-page channel, snapshots, deep links, editor opens and persisted settings. The
user-facing behavior is in the docs site. This file records why each is shaped
as it is.

## HMR incompatibility reasons

When a component cannot be hot-patched in place, the runtime logs one line and,
by default, reloads the page, so the developer loses state and never reads the
log. The reasons are computed exactly in `src/lib/runtime/patch.ts`. They are
now also shown in the panel and to agents.

- **A dedicated always-on channel, not the timeline stream.** The timeline is
  gated per capture layer on the recording flag inside the page runtime, and
  most developers are not recording when a patch fails. Routing through
  `addTimelineEvent` would also couple the always-on patcher to the optional
  `timeline: true` module. The runtime instead sends `lit:hmr:incompatible`
  (`src/types/hmr-incompatibility.ts`) and the node side caches and broadcasts
  it, the inspector's pattern. Streaming is reserved for high-volume data, and
  these events are rare.
- **The send happens before `location.reload()`.** This is the one addition to
  `patch.ts`, which is the most safety-critical file in the package. Keep it to
  that single call. Whether the message survives the navigation can only be
  confirmed by hand against a real dev server.
- **It is a banner in the Components tab plus a count badge on the tab strip,
  not a new tab.** An incompatibility is about one custom element, which is what
  the Components tab is for, and the panel's cost to watch is tab sprawl. The
  badge makes it visible from other tabs.
- **`ctx.diagnostics` is a terminal echo, not storage.** It has no read-back, so
  the capped cache (`MAX_HMR_INCOMPATIBILITIES`) exists regardless. The echo
  serves agents that only see dev-server stdout. The console, the terminal and
  the panel are three audiences for one event, so they share one formatter
  (`describeHmrReason`) to keep the wording consistent.
- **A fourth reason** must extend `HmrIncompatibilityReason` and
  `describeHmrReason` together, plus the limitations docs page.
  `observed-attributes-changed` has `action: 'none'`, since the patch succeeds
  and never reloads.

## Agent access to the timeline

- **`lit:recent-events` is one raw, filtered query, not a summarizing tool.** An
  LLM already summarizes structured events well, and a node-side summarizer
  would add a second schema to keep in sync with `TimelineEvent` and force
  heuristics like "what is a render storm" with no feedback. Filters (`layerId`,
  `elementId`, `tagName`, `sinceMs`, `limit`) let the agent ask the specific question. The
  summary tool that did arrive (below) came from a stronger reason.
- **The history is a node-side ring buffer in `definition.ts`,** capped at
  `RECENT_EVENTS_BUFFER_SIZE` (512). The stream's internal replay buffer is
  marked `@internal` by Devframe, so it is not a contract to lean on. The buffer
  and the stream's `replayWindow` are independent constants that happen to
  match.
- **Payloads are bounded server-side.** The default limit is 50 and the ceiling
  200, whatever the caller asks. Custom-event `data` is not size-capped. That is
  accepted until it is a real problem.
- **`sinceMs` is relative to the newest buffered event,** because event times
  are recording-relative and share no clock with node.
- **Agents can address a component by tag name.** The question an agent gets
  names `<todo-item>`, not an element id, and the id route cost a full
  `list-components` call plus a scan first. `component-details` and
  `recent-events` therefore take `tagName`, matched case-insensitively. The
  `{id}` form of `component-details` is unchanged because the static snapshot
  bakes it per id. The tag-name form reads the live tree, then each match, and
  returns a `missing` list for matches the page reports gone or that nothing
  answered for and the cache lacks; it is capped (20, ceiling 50) with
  `truncated`. `list-components` takes `maxDepth` so a large app does not flood
  the agent's context, and marks cut nodes with `hiddenChildren`. The filtering
  lives in `devframe/session.ts`, not `timeline/filter.ts`, which is the
  panel's.
- **The response always carries `recording: boolean`.** With recording off,
  `events` is empty and the tool description tells the agent to enable
  recording, so "not recording" is distinguishable from "recording but quiet".
- **`set-recording` is agent-callable,** the one mutation. Without it the read
  tool is a dead end when recording is off. The picker, layer toggles, settings,
  editor opens and snapshot export stay panel-only, because an agent that
  silently changes the developer's tool state, spawns a GUI process or writes to
  disk is a different trust level.
- **`list-components` and `component-details` ask the page on each call.** The
  session caches only what the panel last requested, so an agent with no panel
  open read an empty tree from a live page. The two queries now send the
  inspector command themselves and await the reply (`inspector-request.ts`),
  falling back to the cache after a short timeout so the null source and a
  departed page cannot hang a tool call. The replies still pass through the
  cache and the broadcast, so an open panel sees the same refresh.
- **Event ids are `${epoch}-${seq}`,** stamped once in `pushEvents`, the only
  place stream, `recent-events` and export share. The epoch is the session
  start, so a restarted server never reissues an id an older snapshot holds. The
  seq never resets across Clear.

## Update explainer

The timeline answers "why did this re-render" and "which component re-renders
too much", using data the capture layer already produced: `groupId` pairing and
`data.changed`. The panel used to render one row per raw event and discard both.

- **Derivation is pure and in `src/lib/timeline/derive.ts`.** It imports only
  `src/types/timeline.ts`, so the panel and `definition.ts` share it (the
  definition must stay framework-neutral) and it is unit-testable in the
  node-env project. There are no panel DOM tests.
- **The panel derives client-side; the definition derives only for agents
  (`lit:update-summary`).** The panel holds 5000 events (`MAX_EVENTS` in
  `src/panel/timeline-store.ts`), the server ring holds 512 and `recent-events`
  returns at most 200. Deriving on the server for the panel would shrink its
  window by an order of magnitude.
- **One panel-side event buffer (`timeline-store.ts`).** A second view
  subscribing to the stream would double-buffer. The store owns the
  subscription, the cap and the snapshot one-shot, and views read from it.
- **Collapsed duration rows are the default; the raw log stays behind a
  toggle.** The chronological log is still right for ordering questions and
  custom layers. It is demoted, not removed.
- **Layer ids are unchanged.** Merging mouse and keyboard into one `input` layer
  would break `TIMELINE_LAYERS`, `LAYER_FLAGS`, the documented built-in ids for
  `addTimelineEvent`, and an e2e assertion, to save one pill. The input layers
  instead earn their place by attribution: `attributeInput` gives an update a
  `cause` from the latest mouse or keyboard event within a 200 ms window. An
  update with a cause is an interaction. One without is a timer, a signal or a
  stray `requestUpdate`.
- **Recording's rising edge clears both buffers.** The runtime clock re-zeroes
  there, so a record, stop, record cycle without a reload would otherwise keep
  old events on a larger time origin and produce negative durations and
  mispaired spans. The clear sits in the `session.on('updated')` listener, the
  single push point for recording changes, and not in the `set-recording`
  handler, since the panel can mutate the shared state directly.
- **A throwing phase is recorded on its `:end` event, then rethrown.**
  `logType` and the Chrome-tracks red colour existed but nothing set them. The
  wrapper catches only to describe (`name`, truncated `message`, no stack) and
  rethrows unchanged, so the app sees the same error. The end event owns the
  error because that is when it is known; `derive.ts` lifts it onto the span,
  the cycle (innermost phase wins, since `performUpdate` rethrows what `update`
  threw) and a per-component `errors` count. Not built here: attributing
  `window.onerror` to a host.
- **Old and new values are a layer flag, not a new RPC.** Changed values is a
  boolean on `TimelineLayersState` plus a pseudo-layer id, mirroring
  `litRenderVerboseEnabled`. That reuses the pill strip and `toggle-layer`, and
  adds no wire surface. The layer emits no events, only data on the
  `lit-lifecycle` update events, so the Timeline gives it a pill but no lane.
  It is off by default because each key costs a `serialize`.
- **Values are captured on `update`, not `willUpdate`.** A component overriding
  `willUpdate` without `super` shadows our wrapper, while `update` is wrapped on
  its effective owner, and the values are final by then. One capture per tick.
- **Equality is computed on the raw values, with a budget.** Comparing the
  previews would stop at depth two and call `{a: {b: {c: 1}}}` equal to
  `{a: {b: {c: 2}}}`. `budgetedDeepEqual` visits at most 200 values to depth six
  and never invokes a getter, and gives up as "not equal". Capture is capped at
  16 keys per update; `changed` still lists them all.
- **Not wasted-render detection.** "New reference, same value" is a fact about
  the assigned value. Whether the DOM then changed is still unknown, so the
  panel reports the assignment and leaves the conclusion to the reader.
- **Not built: a flamechart or scrubber.** Lit update ticks are sub-millisecond
  and sparse, so it would be mostly whitespace, and Chrome's Performance panel
  already does it better. The value here is attribution and frequency, which is
  a table.
- **Not built: wasted-render detection.** The valuable version, an update that
  changed no DOM, cannot be known from the event stream without diffing rendered
  output. The cheap proxy (changed keys unused by `render()`) would mislead too
  often. Revisit only with a real signal from lit-html.

## CLI and stdio MCP

`bin.mjs` is the `lit-devtools` command with `dev`, `build` and `mcp`.

- **`mcp` proxies a running dev server; it does not boot the definition.** A
  fresh in-process definition has a null source and no page, so every component
  query would answer empty while the server looked healthy. A confidently wrong
  MCP server is worse than none. This is also why `bin.mjs` uses a bare `cac()`
  instead of Devframe's `createCac()`, whose stock `mcp` command does exactly
  that and whose default-command registration cannot be cleanly overridden.
  `cac` and `@devframes/agentic` are optional peers, imported only on the path
  that needs them.
- **Discovery needs the Vite host to register itself.** `startConnectServer()`
  finds instances through Devframe's instance registry, or by probing ports at
  the root path only. The DevTools hub mounts under `/__devtools/` and does not
  register by default (`initHub()` runs with `register` off), so neither path
  finds it. `vite.ts` therefore calls `registerDevframeInstance()` itself, once
  the server is listening.
- **Registration is verified before it is published.** The base path is a peer
  package's constant (`DEVTOOLS_MOUNT_PATH`), not a contract. The plugin probes
  the guess with `probeDevframeOrigin()` first and takes the MCP path from what
  the probe reports. If the probe fails it does nothing, since a record that
  404s to the agent it advertised itself to is worse than no record. Records are
  keyed by `pid` and `port`, so another Devframe host in the same process would
  share the file and whoever unregisters first removes it for both.
  Single-devframe use is the common case.
- **Fallback with no discovery:** any stdio to HTTP bridge such as `mcp-remote`
  can front the hub's aggregate route at `<origin>/__devtools/__mcp`.
  `lit-devtools mcp --port` probes root-mounted instances only, so it finds a
  standalone server but not a Vite-hosted one.
- **`dev` (standalone) default port is 5180,** not the playground's 5179, so
  running both against one checkout does not fight over a port.
- **`dev` is for pages outside Vite.** The page runtime talks through
  `src/lib/runtime/page-channel.ts`, whose default carrier is the HMR socket. A
  page calls `connectToDevServer(url)` (exported as
  `@oddsquad/vite-plugin-lit/connect.js`, `src/lib/runtime/rpc-transport.ts`),
  which attaches an RPC carrier. The server side is `RpcTimelineSource`
  (`src/lib/devframe/rpc-source.ts`). HMR patching, source metadata and
  open-in-editor still need Vite's transforms and are out of scope.
- **`lit-devtools dev` serves `/lit-devtools.js`,** an IIFE built by
  `build:standalone` from `src/lib/runtime/standalone.ts` and prefixed with the
  connection descriptor. The descriptor is inlined because a page on another
  origin cannot fetch the CORS-less `__connection.json`, and only the needed
  fields are copied, so nothing else leaks to any page that can load a script
  tag. The route goes on an H3 app passed into `createDevServer`, since
  Devframe's static catch-all 404s anything added later.
- **Origins and auth.** `--allow-origin` feeds Devframe's WebSocket and SSE
  origin gates and accepts a host wildcard (`https://*.webcontainer-api.io`),
  needed because StackBlitz gives each port its own generated origin. The
  wildcard must keep two literal labels after `*`, so `*.com` cannot admit most
  of the web. Loopback origins are always allowed. `--no-auth` is refused on a
  non-loopback host, since without the one-time-code gate anything that can
  reach the port drives the panel's RPC.
- **`build` deliberately explains instead of building** (see Static snapshot).

## In-page channel

The hover outline moved from panel to node to Vite HMR to page onto Devframe's
in-page channel (`src/types/in-page.ts`, `src/panel/in-page.ts`,
`src/lib/runtime/inspector/highlight.ts`). It removes a round trip through the
dev server to draw a box the page can draw itself, and it keeps working with no
node side, which a snapshot needs.

- **Only `highlight` moved.** Tree and details stay on RPC, because the node
  side caches them so a late panel has something to render and MCP can answer
  with no panel open. The picker stays on the node side too: its Pick button
  also raises the Lit dock, a hub concept the page cannot reach, and splitting
  one interaction over two transports gains nothing.
- **The page endpoint is created outside the `import.meta.hot` gate,** since not
  needing a dev server is the point. It clears the outline when the panel
  disconnects, so a panel that goes away mid-hover leaves no box painted over
  the app. The panel endpoint connects lazily on first use, because connecting
  posts handshake hellos to every ancestor window.
- **The page also releases Live mode and the watch hook when the last panel
  disconnects,** because their off-switches were RPCs the closing iframe drops.
  Release waits for the _last_ peer, since a reloaded panel connects before the
  old peer's heartbeat times out. The panel re-arms Live from its persisted flag
  on connect and on `ready`, since the page no longer holds the observer across
  panel reloads, and it touches the lazy channel when Live is on so the page can
  see it leave. The own-tab and old-plugin paths stay best-effort, because a
  carrier cannot report the panel leaving.
- **RPC stays as the fallback,** not as padding. A panel opened as its own tab
  has no page script in its ancestry, and an older plugin version has no
  channel.
- **Gotchas:** the injected runtime `src` has a doubled slash
  (`/@fs//Users/...`) while Vite's own imports use one. The browser keys module
  records by URL string, so importing the doubled form runs a second copy of a
  module with its own `WeakMap`. Test the outline's geometry, not its presence,
  since a 0x0 box satisfies a presence check. The channel adds about 10 kB gzip
  to the panel bundle.

## Static snapshot

- **A snapshot is a recorded session, not a copy of the panel.** A fresh CLI
  process has no page, timeline or tree, so a `createBuild()` from there bakes
  an empty shell. The recording lives in the running dev server's memory, so the
  export runs inside that server (`lit:export-snapshot`, `src/lib/snapshot.ts`,
  `src/types/snapshot.ts`) and the CLI's `build` says so.
- **Capture needs no new transport.** `definition.ts` already holds the ring
  buffer, the tree, the opened component details and the incompatibility list.
  The export builds a second definition with `replay` set and a null source,
  seeds the same caches, and runs Devframe's build adapter. `snapshot: true`
  queries take no required argument. `component-details` is baked with
  `rpc.snapshot` entries for the ids the session actually opened. The build
  adapter is imported dynamically because it needs `node:fs`, and
  `definition.ts` must load without it.
- **The frozen panel must not offer what it cannot do.** `isSnapshot()`
  (`src/panel/client.ts`) reads `backend: 'static'`. The Components tab stops
  issuing `inspect` (an action, so absent from the dump). The Timeline tab reads
  `recent-events` once instead of subscribing, because a static deploy has no
  streaming channel and the timeline would render empty. Record and Export are
  disabled.
- **Limits.** Only components opened during the session have details. The
  timeline is capped at the ring buffer. The export writes to the dev server's
  `outDir` and overwrites. It is not agent-exposed.
- **Testing:** `src/test/e2e/snapshot_test.ts` asserts on the emitted dump
  shards, not on "a directory appeared". It is an e2e test because the
  pre-commit per-file type check rejects `node:` imports in unit tests outside
  the root tsconfig.

## Deep linking

Two arrival paths, one `DeepLink` shape (`src/panel/deep-link.ts`).

- **Inside the hub,** `hub:docks:activate` with `{dockId, params}`. The hub
  mirrors the request into the `devframe:docks:active` shared state, so a panel
  that mounts because of the activation still converges on it rather than
  missing the broadcast. An overlay pick activates the dock with
  `{componentId}`, so the target rides on the activation instead of racing a
  separate `pick` message.
- **Standalone or snapshot,** the URL hash: `#tab=components&component=7`,
  `#tab=timeline&event=<id>`. The hash and not the query, because handshake
  tokens live in the query and must not travel in a link pasted into an issue.
- **The panel writes its position back with `replaceState`,** not `pushState`,
  so clicking through a tree does not fill Back with entries. Only when it owns
  its URL, not when docked in an iframe.
- **The hook runs in `firstUpdated()`,** not `connectedCallback()`. The shell
  reaches the Components view through a `@query`, which resolves against
  rendered DOM. Applied earlier, a link silently dropped its selection.
- **Event links work because ids survive.** An id the buffer no longer holds
  opens the Timeline with no selection. Tab names come from one `DEEP_LINK_TABS`
  list that both parsers validate against.

## Open in editor

- **`/__lit-open-in-editor` stays,** with `launch-editor` and `src/lib/http.ts`.
  The source overlay runs in the inspected page with no Devframe client and must
  work with `timeline: false`, which is the documented way to enable it. Only
  the panel's opens go through the Devframe path (`lit:open-source`,
  `src/panel/open-in-editor.ts`).
- **The panel consumes `@devframes/service-open` and does not install it.** The
  Vite hub already installs it (through `@devframes/plugin-messages`) before its
  services barrier. A second install is discarded and warns `DF0066` on every
  dev-server start. The package stays a dev dependency for its type
  augmentation, and panel opens feature-detect the service and otherwise fall
  back to the endpoint.
- **`open-source` resolves the path node-side.** `file` is relative to the Vite
  root, while the service resolves against the host's `workspaceRoot`. In a
  monorepo those differ, and `launchEditor` silently does nothing for a missing
  path. It is confined to the allowed roots before it reaches the service.
  Sources outside the workspace root fall through to the endpoint, which trusts
  `[root, ...server.fs.allow]`.
- **Editor keys are translated, not passed through**
  (`src/lib/devframe/launch-editor.ts`). The overlay's `vscode` is `code` for
  `launch-editor`, and `windsurf` has no entry because the service accepts only
  its own picklist. Unknown or custom editors resolve to undefined and
  `launch-editor` auto-detects.
- **Request trust.** The endpoint's guard once trusted a request with no
  `Origin` header. A cross-site GET (`<img>`, `<iframe>`, a navigation) sends
  none, so any open tab could drive it. `isTrustedRequest` also requires
  `Sec-Fetch-Site` to be `same-origin` or `none`, and trusts a request only when
  every signal it carries agrees and at least one is present. A browser sending
  neither signal on a same-origin GET is rejected, which is the intended
  trade-off for a local dev-only endpoint. Any new dev-server route must call it
  first. Path confinement (`src/lib/confine.ts`) is independent and stays.

## Persisted settings

- **Everything goes in `settings.global`,** not `project`. Which editor, which
  color scheme and how HMR feedback should behave are per-developer. `project`
  maps to `<workspaceRoot>/node_modules/.<app>/devframe`, so it is private per
  checkout and wiped by a clean install. The project-level default already
  exists as the committed `litPlugin({hmr: ...})` config. (Devframe's own
  comment claims `project` is the committable directory. The code says
  otherwise, so trust the code.)
- **The node side must bind the store.** Only the node side backs it with a JSON
  file. Without a node-side touch the panel's writes create a plain in-memory
  shared state that round-trips perfectly and vanishes on restart.
  `definition.ts` awaits `my.settings.global.all()` in `setup()` before any
  client connects.
- **The client store is empty until its first sync.**
  `await settings.global.get(key)` right after connecting returns undefined even
  with a value on disk. The panel subscribes with `onChange` plus one `all()` to
  cover a sync that beat the subscription.
- **`localStorage` stays as a synchronous boot cache.** The runtime in the
  inspected page reads it at startup with or without DevTools open
  (`src/lib/runtime/overrides.ts`), so it cannot wait for a Devframe connection.
  `settings.global` is the durable copy. A fresh browser sees a global override
  only after the panel has connected once.
- **The override is persisted from the panel,** not from the
  `set-settings-override` handler. `_reset()` pushes the resolved env values
  rather than an empty override, so a node-side handler cannot tell a reset from
  a write and would re-persist env values as an override. A panel preference
  also stays out of the framework-neutral definition.
- **Recording and layer toggles stay ephemeral.** A persisted `recording: true`
  would survive a restart that empties the buffer, and show a recording state
  with nothing recording. The layer toggles share one struct with
  `recordingState` and are read and written as a whole. Splitting persistence
  inside it costs more than an unrequested benefit is worth.
- **The color scheme has its own `localStorage` key** and applies only to the
  panel iframe, never to the inspected page.

## One page per session

- **The HMR channel is a broadcast.** `server.hot.send` reaches every page and
  `server.hot.on` hears all of them, so a second tab used to wipe the recording
  and swap the cached tree.
- **The runtime stamps a `pageId` on everything it sends** (`ready`, event
  batches, inspector messages), minted once per document and shared through
  `globalThis` like the page channel. The session follows the page whose
  `ready` arrived last. A `ready` with the same id is a socket reconnect and
  keeps the buffer, since the runtime clock re-zeroes only on the recording
  rising edge. A new id clears and broadcasts `page-changed`, which the panel
  shows as a dismissable banner. The `ready` also carries a `tabId` kept in
  `sessionStorage`, so a reload (new document, same tab) is flagged
  `reload: true`: it still clears, but the panel shows no banner for what the
  developer did themselves. Without storage the tab id falls back to the page
  id and a reload reads as another page; a duplicated tab shares its source's
  id and reads as a reload.
- **Foreign traffic is dropped, not namespaced.** Element ids and clocks would
  otherwise need a second axis in every view. The guard sits above the inspector
  requester so an agent query cannot be answered with another tab's tree.
- **Unstamped traffic always passes.** Runtimes older than the field, the
  overlay's `pick`, custom layer announcements and the HMR-incompatibility
  notices (`patch.ts` stays untouched) carry no id. Stamped traffic that beats
  its page's `ready` also passes, since no page is followed yet.
- **Outbound commands still broadcast.** Pages that are not followed answer and
  are dropped.
