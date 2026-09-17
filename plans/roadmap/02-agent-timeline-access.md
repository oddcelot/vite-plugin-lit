# Plan 02: Give coding agents the timeline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Section "Step 8" is explicitly optional and
> requires a maintainer decision before you touch it; do not implement it
> as part of a routine pass through this plan.
>
> **Drift check (run first)**:
> `git diff --stat 2889243..HEAD -- src/lib/devframe/definition.ts src/lib/devframe/protocol.ts src/lib/devframe/source.ts src/types/timeline.ts src/lib/runtime/timeline/lifecycle.ts src/lib/runtime/timeline/clock.ts src/test/unit/devframe_test.ts docs/src/content/docs/guides/devtools-timeline/index.mdx`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition — the RPC surface and agent-exposure story are
> exactly the kind of thing that drifts quietly.

## Status

- **Priority**: P2 — the timeline is the plugin's differentiator (per
  `plans/devframe-foundation.md`), and today an agent literally cannot see it;
  this is a capability gap, not a defect.
- **Effort**: M — new protocol types, a ring buffer, a new RPC function, unit
  tests, and a docs update. Step 8 (agent-triggered recording) is scoped
  separately and, if taken, adds a docs/product-contract change on top.
- **Risk**: LOW for the read-only surface (Steps 1–7); MEDIUM if Step 8 is
  taken, because it reverses a documented product promise (see Step 8).
- **Depends on**: none. Independent of Plan 04 (typed public timeline API for
  app code) — this plan is entirely about the devframe/MCP-facing RPC
  surface, not the `virtual:lit-plugin/timeline` module app code imports.
- **Category**: feature
- **Planned at**: commit `2889243`, 2026-09-17

## Why this matters

`src/lib/devframe/definition.ts` already registers three `agent`-exposed
query functions — `lit_get-meta`, `lit_list-components`,
`lit_component-details` — so a coding agent can see the component tree and
one element's current state. What it cannot do today is see the **timeline**:
the lifecycle/render/input event stream that is this plugin's reason to
exist over a stock Lit + Vite setup.

The question a developer actually asks an agent is "why did this component
re-render?" — and the timeline is exactly the evidence for that question.
Right now an agent has to infer the answer from source code alone, the same
blind spot a human would have without DevTools open. Closing it is the
single highest-leverage addition to the agent surface this plugin can make.

## Current state

### The timeline only flows into a streaming channel, nothing retains it for request/response

`src/lib/devframe/definition.ts:110-125`:

```ts
if (ctx.mode === 'dev') {
  const channel = my.rpc.streaming.create<TimelineEvent[]>(
    TIMELINE_STREAM_NAME,
    {replayWindow: 512}
  );
  // Started eagerly, not on the first event: `streaming:subscribe` is
  // fire-and-forget on the wire, and a subscribe naming a stream id
  // that does not exist yet is dropped with a DF0030 diagnostic rather
  // than queued. The panel subscribes as soon as it connects, which is
  // normally long before the first event, so the stream has to be
  // there waiting. `??` covers a re-start if the transport aborted it
  // after the last subscriber left.
  channel.start({id: TIMELINE_STREAM_ID});
  const ensureStream = () =>
    channel.get(TIMELINE_STREAM_ID) ??
    channel.start({id: TIMELINE_STREAM_ID});

  source.attach({
    pushEvents(events) {
      if (events.length === 0) return;
      ensureStream().write(events);
    },
    ...
```

MCP tools are request/response (`type: 'query'` RPC functions, per
`definition.ts:171-222`), not subscribers to a push channel. An agent calling
a tool once cannot "subscribe" to `timeline` the way the panel does — it
needs something it can _ask_, and get an answer back from, on demand.

### `StreamSink.buffer` exists but is explicitly not a public contract

devframe already keeps a per-stream replay buffer for reconnecting
panels (`replayWindow: 512` above). It is tempting to read it directly for an
agent query instead of keeping a second buffer. Don't — devframe's own
type declarations mark it internal:

`node_modules/devframe/dist/context--tVkJw3W.d.mts:1783-1796` (inside
`interface StreamSink<T>`):

```ts
  /**
   * Internal: RPC layer subscribes to receive chunk/end notifications.
   * Not part of the public contract; do not call directly.
   *
   * @internal
   */
  readonly events: EventEmitter<StreamSinkEvents<T>>;
  /**
   * Internal replay buffer. RPC layer reads on (re)subscribe to feed
   * missed chunks before going live.
   *
   * @internal
   */
  readonly buffer: ReadonlyArray<BufferedChunk<T>>;
```

`@internal` is a documentation convention, not something `tsc` enforces —
`channel.get(id)!.buffer` would compile today. But "not part of the public
contract" is devframe's own words for its own field, and devframe is on a
much faster release cadence than this plugin (0.5.4 → 0.8.2 → 1.0.0 already
sit side by side in this repo's lockfile). Reading it anyway means this
plugin can break on a devframe patch bump with no compiler error to catch it.

**Recommendation: maintain a small node-side ring buffer in `definition.ts`,
fed by the same `pushEvents` hook that already exists, instead of reaching
into `StreamSink.buffer`.** It's a few lines, it mirrors a pattern this file
already uses (see next section), and it stays entirely inside code this
plugin owns.

### The definition already caches page-runtime state the same way this needs to

`src/lib/devframe/definition.ts:101-105`:

```ts
// Latest inspector snapshot, cached so a panel that (re)connects after
// the runtime already answered can read it without round-tripping to
// the page again.
let cachedRoots: InspectorTreeNode[] = [];
const cachedDetails = new Map<number, InspectorDetails>();
```

`RPC_LIST_COMPONENTS` and `RPC_COMPONENT_DETAILS` just read these (
`definition.ts:195-222`). A `recentEvents: TimelineEvent[]` array declared at
the same scope, trimmed to a fixed size inside the existing `pushEvents`
callback, is the same pattern applied to the timeline.

### Timestamps are recording-relative, not wall-clock — this constrains any time-window filter

`src/lib/runtime/timeline/clock.ts:7-25` (full file):

```ts
/**
 * Recording-relative clock for the timeline.
 *
 * Built-in capture layers timestamp events with {@link now} rather than raw
 * `performance.now()`, so event times read as "ms since recording started"
 * (the first event is ~0) instead of "ms since the app page loaded" — which is
 * also meaningless to the panel, an iframe with its own time origin. The origin
 * is re-zeroed on each rising edge of recording via {@link resetClock}.
 */

let epoch = 0;

/** Re-zero the clock; called when recording transitions off → on. */
export const resetClock = (): void => {
  epoch = performance.now();
};

/** Milliseconds since the last {@link resetClock}. */
export const now = (): number => performance.now() - epoch;
```

`TimelineEvent.time` (`src/types/timeline.ts:13-17`) is stamped with this
`now()` in the browser page. It has **no fixed relationship to the Node
process's clock** — Node's `Date.now()` or `performance.now()` cannot be
subtracted from a page-relative "ms since recording started" value to get a
meaningful "events from the last N ms." A `sinceMs` filter must be computed
**relative to the newest timestamp already in the buffer**, not against any
server-side wall clock. (`src/types/timeline.ts:15`'s own doc comment —
`` `performance.now()` timestamp in the browser`` — is slightly imprecise
about this; it predates `clock.ts`'s recording-relative rezeroing. Worth a
one-line fix while touching this file, out of scope to chase further here.)

### `elementId` is already a stable, queryable field on lifecycle/render events

`src/lib/runtime/timeline/lifecycle.ts:94, 103-111`:

```ts
    const elementId = idOf(this);
    const tagName = (this as Element).localName ?? 'unknown';
    const source = sourceOf(this);
    ...
    if (!isPoint) {
      emit({
        layerId: 'lit-lifecycle',
        time,
        groupId,
        title: name + ':start',
        subtitle: tagName,
        data: {phase: name, changed},
        meta: {elementId, tagName, source},
      });
    }
```

This `elementId` is the same numeric id `RPC_COMPONENT_DETAILS` takes
(`ComponentDetailsArgs.id`, `protocol.ts:102-105`), so an agent's natural
workflow — `list-components` → pick an id → filter events by that id —
is already wired end to end by existing ids.

### The MCP surface is documented today as strictly read-only, including for recording

`docs/src/content/docs/guides/devtools-timeline/index.mdx:83-98`:

```mdx
## Ask a coding agent

The panel is a [devframe](https://devfra.me), so the same data it renders is
exposed to coding agents over MCP. Vite DevTools mounts the server at
`/__mcp` on the dev server, and three read-only tools appear there:

| Tool                    | Answers                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `lit_get-meta`          | Plugin version, available timeline layers, resolved settings.         |
| `lit_list-components`   | The live element tree, with each component's source file and line.    |
| `lit_component-details` | Reactive properties, attributes, and update flags for one element id. |

Nothing that changes the page is exposed: recording, layer toggles, and the
element picker stay panel-only. Point your agent at the dev server's `/__mcp`
endpoint and it can answer "what's on this page and what state is it in?"
against the running app instead of guessing from source.
```

This is a **published product promise**, not just an internal default. It
matches the design decision recorded in `plans/devframe-foundation.md:162-163`
("Agent surface is read-only by default... Inspector actions stay UI-only
until there's a use case"). This plan's Steps 1–7 keep that promise entirely
intact. Step 8 discusses breaking it, on purpose, and is scoped so a
maintainer can say no without touching anything else in this plan.

### Recording is off by default

`src/types/timeline.ts:45-51`:

```ts
export const DEFAULT_LAYERS_STATE: TimelineLayersState = {
  recordingState: false,
  litLifecycleEnabled: true,
  litRenderEnabled: true,
  mouseEventEnabled: false,
  keyboardEventEnabled: false,
};
```

An agent calling a timeline-reading tool on a fresh dev session gets nothing,
by design — matching what a human sees opening the panel cold. The tool must
say so explicitly rather than returning an empty array indistinguishable
from "recording is on and nothing has happened yet."

### devframe already has a formal, non-read mutation classification for agents — this is relevant context for Step 8, not for Steps 1–7

`node_modules/devframe/dist/types-BmDbfHCx.d.mts:22-51` (`RpcFunctionAgentOptions`):

```ts
interface RpcFunctionAgentOptions {
  /**
   * Human-readable description shown to the agent. Required, since agents
   * rely on this to decide when to invoke the tool. Keep it to ~1–3
   * sentences explaining what the tool does and when to use it.
   */
  description: string;
  ...
  /**
   * Safety classification. Drives MCP annotations (`readOnlyHint`,
   * `destructiveHint`) downstream.
   * - `'read'`: no side effects; safe to call freely.
   * - `'action'`: mutates state but not destructive.
   * - `'destructive'`: may perform destructive updates.
   *
   * When omitted it is inferred from the function `type`:
   *   - `'static'` / `'query'` → `'read'`
   *   - `'action'` / `'event'` → `'action'`
   */
  safety?: 'read' | 'action' | 'destructive';
  ...
```

The existing `RPC_SET_RECORDING` action (`definition.ts:241-252`) already has
no `agent` field, so it is invisible to the MCP surface today — confirmed by
`docs/.../devtools-timeline/index.mdx:95` above. Mechanically, exposing it is
a one-line addition (`agent: {description: '...'}`, safety defaults to
`'action'`). The cost is not technical; it's the documented promise it
breaks. See Step 8.

### Session recording state — the single source of truth the new tool reads

`src/lib/devframe/protocol.ts:71-90`:

```ts
/**
 * Recording/layers snapshot shared between every surface (panel, page
 * runtime, MCP). Survives reconnect; mutated either by the `set-recording` /
 * `toggle-layer` actions below or directly by a panel through the generic
 * shared-state RPC devframe provides.
 *
 * `layers.recordingState` is the single authority for "is recording" — the
 * runtime's own layer state carries it, so a separate flag here would be a
 * second copy to keep in sync.
 */
export interface SessionState {
  layers: TimelineLayersState;
  /** Layers announced at runtime by app code through `addTimelineLayer()`. */
  customLayers: TimelineLayer[];
}
```

## Design

### Decision 1 — where recent events live: a node-side ring buffer, not `StreamSink.buffer`

Add a `recentEvents: TimelineEvent[]` array to `definition.ts`, declared next
to `cachedRoots`/`cachedDetails` (before the `if (ctx.mode === 'dev')` block),
and pushed into from inside the existing `pushEvents(events)` callback,
trimmed to a fixed cap (`RECENT_EVENTS_BUFFER_SIZE = 512`, matching the
stream's own `replayWindow` so the agent and the panel see comparable
history). This is a few lines, owned entirely by this plugin, and avoids
depending on a field devframe itself calls internal.

### Decision 2 — tool surface: one raw, filtered query — not a summarizing tool

Recommendation: ship **`lit:recent-events`**, a raw filtered query, and do
**not** build a separate "summarize the timeline" tool in this pass.

Reasons:

1. The calling agent is an LLM. Summarizing a list of structured events is
   exactly the kind of thing it's already good at; a bespoke node-side
   summarizer duplicates that and adds a second schema to keep in sync with
   `TimelineEvent` forever.
2. The three existing tools are all raw-data queries (`get-meta`,
   `list-components`, `component-details`). A summarizing tool would break
   that established shape and require inventing heuristics ("what counts as
   a render storm?") with no user feedback yet to ground them.
3. Filters (`layerId`, `elementId`, `sinceMs`, `limit`) already let an agent
   ask the specific question a developer has — "show me lifecycle events for
   element 42 in the last 2 seconds" — without a summarization layer at all.

If real usage later shows raw events aren't enough (e.g. an agent burning
context re-deriving the same "N re-renders in M ms" pattern every time), a
summarizing tool is a follow-up, not a blocker here.

### Bounding the payload

- Server-side ring buffer capped at `RECENT_EVENTS_BUFFER_SIZE = 512` events
  total (all layers combined).
- The RPC handler enforces `limit = Math.min(args.limit ?? 50, 200)` —
  default 50, hard ceiling 200, regardless of what the caller asks for. This
  mirrors devframe's own bounding philosophy (`highWaterMark` on streaming
  consumers) rather than trusting the caller.
- `data` on a custom app-emitted event (`addTimelineEvent`, see Plan 04) is
  not further size-capped in this pass — `jsonSerializable: true` already
  forces strict JSON encoding, but a large `data` payload from app code could
  still make one event's response large. Accepted as a known limitation for
  now (YAGNI); flag it as a follow-up if it becomes a real problem rather
  than adding a byte-cap nobody has asked for yet.

### Decision 3 — the recording-off case: read-only default; a triggerable start is a separate, flagged option

**Default (Steps 1–7, what this plan implements):** `lit:recent-events`
always returns an explicit `recording: boolean` field, read from
`session.value().layers.recordingState`. When `false`, `events` is `[]` and
the tool description tells the agent what that means and what to do about
it — ask the developer to flip Recording on in the Timeline tab — rather than
silently returning nothing indistinguishable from "recording, but quiet."

**Not the default — see Step 8:** having the agent flip recording on itself.
Mechanically trivial (add `agent: {...}` to the existing `set-recording`
action), but it reverses the explicit, published promise in
`docs/.../devtools-timeline/index.mdx:95-98` ("Nothing that changes the page
is exposed... stay panel-only"). This plan treats "why did it re-render" as
exactly the use case `plans/devframe-foundation.md:163` said would justify
revisiting that stance — but flipping a documented product promise is a
maintainer call, not something a timeline-access plan should do as a side
effect. Step 8 is written out in full so the maintainer can take it in one
sitting if they agree, but it is explicitly out of the "done" criteria for
this plan.

### `agent.description` strings to ship

For `lit:recent-events` (matches the WHEN-to-use tone of the existing three):

```
Get recent timeline events (lifecycle, render, mouse, keyboard) to diagnose
why a component re-rendered or updated. Call list-components first to find
an element's id, then filter by elementId to see just its events. Check the
`recording` field in the response — if false, no events are being captured;
ask the developer to enable Recording in the Timeline tab before retrying.
```

## Scope

**In scope**:

- `src/lib/devframe/protocol.ts`
- `src/lib/devframe/definition.ts`
- `src/test/unit/devframe_test.ts`
- `docs/src/content/docs/guides/devtools-timeline/index.mdx`

**Out of scope** (do NOT touch as part of Steps 1–7):

- `src/lib/devframe/source.ts` and `src/lib/devframe/vite.ts` — no new
  page→node wire message is needed; `pushEvents` already carries every event
  this plan reads.
- Adding `agent` to `RPC_SET_RECORDING` or any other action — that's Step 8,
  gated separately.
- A summarizing/aggregation tool — explicitly rejected above, not deferred
  silently.
- `src/lib/runtime/timeline/clock.ts` — the doc-comment imprecision noted
  above is a one-line nit for whoever next touches that file, not this plan.
- Repo-root `lib/`, `types/`, `panel/`, `index.js` — generated build output.

## Commands you will need

| Purpose           | Command                                        | Expected on success |
| ----------------- | ---------------------------------------------- | ------------------- |
| Install           | `pnpm install`                                 | exit 0              |
| Format/lint/types | `pnpm exec vp check`                           | exit 0              |
| Unit tests        | `pnpm run test:unit`                           | exit 0              |
| Build             | `pnpm run build`                               | exit 0              |
| Timeline e2e      | `pnpm exec vp test run --project e2e timeline` | exit 0 (slow)       |

## Git workflow

- Branch: `roadmap/02-agent-timeline-access`
- Commit message style: capitalized imperative summary, no conventional-commit
  prefix (e.g. `Add a recent-events MCP tool for the timeline`).
- Do NOT push or open a PR without asking first.

## Steps

### Step 1: Add the wire contract in `protocol.ts`

In `src/lib/devframe/protocol.ts`:

1. Add `TimelineEvent` to the existing `import type {...} from '../../types/timeline.js'` block (it currently imports `TimelineLayer`, `TimelineLayersState`, `FeatureSettings`, `SettingsOverride` but not `TimelineEvent`).
2. Add a bare-name constant next to `RPC_TOGGLE_LAYER` etc.:
   ```ts
   /** Bare name of the `recent-events` query. */
   export const RPC_RECENT_EVENTS = 'recent-events';
   ```
3. Add a buffer-size constant near `TIMELINE_STREAM_ID`:
   ```ts
   /**
    * Cap on the node-side recent-events ring buffer, matching the timeline
    * stream's own `replayWindow` so an agent and a (re)connecting panel see
    * comparable history.
    */
   export const RECENT_EVENTS_BUFFER_SIZE = 512;
   ```
4. Add argument/result interfaces next to `ComponentDetailsArgs`:
   ```ts
   /** Argument of the `recent-events` query. */
   export interface RecentEventsArgs {
     layerId?: string;
     elementId?: number;
     /**
      * Only events from the last `sinceMs` milliseconds, measured against
      * the newest event currently in the buffer — not wall-clock time.
      * `TimelineEvent.time` is "ms since recording started" in the page
      * (see `runtime/timeline/clock.ts`), which has no fixed relationship
      * to this process's clock.
      */
     sinceMs?: number;
     /** Default 50, hard ceiling 200 regardless of what's requested. */
     limit?: number;
   }

   /** Result of the `recent-events` query. */
   export interface RecentEventsResult {
     /** Whether the timeline is currently recording. */
     recording: boolean;
     /** Most recent events matching the filters, oldest first. */
     events: TimelineEvent[];
     /** Total events currently held in the ring buffer, before filtering. */
     bufferSize: number;
     /** True if filtering matched more events than were returned. */
     truncated: boolean;
   }
   ```
5. Add the entry to `DevframeRpcServerFunctions`:
   ```ts
   'lit:recent-events': (args: RecentEventsArgs) => Promise<RecentEventsResult>;
   ```

**Verify**: `pnpm exec vp check` → exit 0.

### Step 2: Maintain the ring buffer in `definition.ts`

1. Import `RECENT_EVENTS_BUFFER_SIZE` and `RPC_RECENT_EVENTS` (and the new
   types) from `./protocol.js` alongside the existing imports.
2. Next to `cachedRoots`/`cachedDetails` (`definition.ts:101-105`), add:
   ```ts
   // Bounded history for the `recent-events` agent query. A plain array,
   // not `StreamSink.buffer` (devframe marks that field `@internal`; see
   // plans/roadmap/02-agent-timeline-access.md).
   const recentEvents: TimelineEvent[] = [];
   ```
3. Inside the existing `pushEvents(events) { ... }` callback
   (`definition.ts:128-131`), after the `ensureStream().write(events)` call,
   append and trim:
   ```ts
   recentEvents.push(...events);
   if (recentEvents.length > RECENT_EVENTS_BUFFER_SIZE) {
     recentEvents.splice(0, recentEvents.length - RECENT_EVENTS_BUFFER_SIZE);
   }
   ```

**Verify**: `pnpm exec vp check` → exit 0.

### Step 3: Register the `lit:recent-events` query

After the `RPC_COMPONENT_DETAILS` registration (`definition.ts:208-222`), add:

```ts
my.rpc.register(
  defineRpcFunction({
    name: RPC_RECENT_EVENTS,
    type: 'query',
    jsonSerializable: true,
    agent: {
      description:
        'Get recent timeline events (lifecycle, render, mouse, keyboard) to diagnose why a component re-rendered or updated. Call list-components first to find an element’s id, then filter by elementId to see just its events. Check the `recording` field in the response — if false, no events are being captured; ask the developer to enable Recording in the Timeline tab before retrying.',
    },
    handler: async (args: RecentEventsArgs): Promise<RecentEventsResult> => {
      const recording = session.value().layers.recordingState;
      let filtered = recentEvents;
      if (args.layerId !== undefined) {
        filtered = filtered.filter((e) => e.layerId === args.layerId);
      }
      if (args.elementId !== undefined) {
        filtered = filtered.filter((e) => e.meta?.elementId === args.elementId);
      }
      if (args.sinceMs !== undefined && filtered.length > 0) {
        const cutoff = filtered[filtered.length - 1]!.time - args.sinceMs;
        filtered = filtered.filter((e) => e.time >= cutoff);
      }
      const limit = Math.min(args.limit ?? 50, 200);
      const events = filtered.slice(-limit);
      return {
        recording,
        events,
        bufferSize: recentEvents.length,
        truncated: events.length < filtered.length,
      };
    },
  })
);
```

Note this handler reads `recentEvents` and `session`, both closed over from
the outer `setup()` scope — same pattern as `RPC_LIST_COMPONENTS` reading
`cachedRoots`. It works unmodified when `ctx.mode !== 'dev'`: `recentEvents`
stays `[]` and `recording` reads the default session state, matching how
`list-components` degrades today.

**Verify**:

- `pnpm exec vp check` → exit 0.
- `grep -n "StreamSink\|\.buffer\b" src/lib/devframe/definition.ts` → no
  matches (confirms the ring buffer, not the internal field, is the source).

### Step 4: Unit tests in `devframe_test.ts`

In `src/test/unit/devframe_test.ts`:

1. Add `'lit:recent-events'` to the name list in the "registers the scoped
   rpc surface" test.
2. Add a new test exercising filters and the recording flag, following the
   existing `boot()` / `source.sink!.pushEvents(...)` pattern used elsewhere
   in this file (e.g. the "caches the latest inspector tree and details"
   test uses `source.sink!.inspectorMessage(...)` the same way):
   ```ts
   test('recent-events filters by layer, element, and reports recording state', async () => {
     const {ctx, source} = await boot();
     let result = await ctx.rpc.invokeLocal('lit:recent-events', {});
     expect(result.recording).toBe(false);
     expect(result.events).toEqual([]);

     await ctx.rpc.invokeLocal('lit:set-recording', {recording: true});
     source.sink!.pushEvents([
       {layerId: 'lit-lifecycle', time: 0, data: {}, meta: {elementId: 1}},
       {layerId: 'mouse', time: 10, data: {}},
       {layerId: 'lit-lifecycle', time: 20, data: {}, meta: {elementId: 2}},
     ]);

     result = await ctx.rpc.invokeLocal('lit:recent-events', {});
     expect(result.recording).toBe(true);
     expect(result.events.length).toBe(3);
     expect(result.bufferSize).toBe(3);

     result = await ctx.rpc.invokeLocal('lit:recent-events', {
       layerId: 'lit-lifecycle',
     });
     expect(result.events.length).toBe(2);

     result = await ctx.rpc.invokeLocal('lit:recent-events', {elementId: 1});
     expect(result.events).toEqual([
       {layerId: 'lit-lifecycle', time: 0, data: {}, meta: {elementId: 1}},
     ]);
   });

   test('recent-events caps the ring buffer and marks truncation', async () => {
     const {ctx, source} = await boot();
     const events = Array.from({length: 520}, (_, i) => ({
       layerId: 'mouse',
       time: i,
       data: {},
     }));
     source.sink!.pushEvents(events);

     const result = await ctx.rpc.invokeLocal('lit:recent-events', {
       limit: 200,
     });
     expect(result.bufferSize).toBe(512); // RECENT_EVENTS_BUFFER_SIZE
     expect(result.events.length).toBe(200);
     expect(result.truncated).toBe(true);
   });
   ```
   Adjust exact literals if `RECENT_EVENTS_BUFFER_SIZE` changes; import it
   from `../../lib/devframe/protocol.js` instead of hardcoding `512` if you
   prefer — either is fine, but do not let the test and the constant drift.

**Verify**: `pnpm run test:unit` → exit 0.

### Step 5: Docs

In `docs/src/content/docs/guides/devtools-timeline/index.mdx`, add a fourth
row to the tools table (`:89-93`):

```md
| `lit_recent-events` | Recent lifecycle/render/input events, filterable by element or layer. |
```

Leave the "Nothing that changes the page is exposed... stay panel-only"
sentence (`:95-98`) as-is — Steps 1–7 do not touch it. If Step 8 is taken
later, that sentence must be rewritten in the same commit that adds the
`agent` field to `set-recording`, not before.

**Verify**: `pnpm run format:check` → exit 0 (or `pnpm run format` then
re-check).

### Step 6: Build and gate

**Verify**:

- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0
- `pnpm run build` → exit 0
- `pnpm exec vp test run --project e2e timeline` → exit 0

### Step 7: Manual confirmation (best effort, optional but preferred)

1. `pnpm run dev` (playground at `http://localhost:5179`, `timeline: true`).
2. Open the dev server's `/__mcp` endpoint with an MCP-capable client (or
   Vite DevTools' own MCP inspector if available) and confirm
   `lit_recent-events` appears with the description from Step 3.
3. With recording off, call it and confirm `recording: false`, `events: []`.
4. Turn Recording on in the panel, interact with the playground app, call it
   again and confirm events appear, `elementId` filtering narrows them, and
   `bufferSize`/`truncated` behave as expected.

If you cannot run an MCP client, say so explicitly in your report.

## Step 8 (optional, requires maintainer sign-off before starting)

### Let an agent start recording itself

**Do not implement this without explicit maintainer approval** — it reverses
the published statement in
`docs/.../devtools-timeline/index.mdx:95-98` ("Nothing that changes the page
is exposed... stay panel-only") and the design decision in
`plans/devframe-foundation.md:162-163`.

**The argument for**: an agent asked "why did this re-render" that finds
recording off is currently a dead end — the developer has to notice the
tool's `recording: false`, go flip a switch by hand, ask the agent to retry,
and hope the bug reproduces again. `set-recording` toggles one boolean with
no data-loss potential, already has a human-facing UI and existing test
coverage (`devframe_test.ts` "actions mutate the session"), and devframe's
own type system already classifies an `action`-typed function as
`safety: 'action'` by default — "mutates state but not destructive," exactly
this case.

**The argument against**: it is a shared, global toggle
(`SessionState.layers.recordingState`, `protocol.ts:71-90`) — an agent
turning it on affects a human's panel view too, silently, from the agent's
side of a possibly-separate conversation. "Read-only by default" is not just
an implementation default here; it is a promise this project has already
published to users. Reversing it should be a deliberate, visible product
change (a docs rewrite, a changelog entry), not a line added while
implementing an unrelated timeline-visibility plan.

**If the maintainer approves**, the change is small:

1. In `definition.ts`, add an `agent` field to the existing
   `RPC_SET_RECORDING` registration (`:241-252`):
   ```ts
   agent: {
     description:
       'Start or stop timeline recording. This is a shared toggle: turning it on also affects the DevTools panel if a developer has it open. Call this if lit:recent-events reports `recording: false`.',
   },
   ```
2. Rewrite `docs/.../devtools-timeline/index.mdx:95-98` to describe the new
   contract accurately (recording is now agent-triggerable; the picker and
   layer toggles remain panel-only).
3. Add a unit test asserting `'lit:set-recording'` carries an `agent` field
   reachable through the MCP manifest (devframe exposes this via its own
   introspection RPC — check `ctx.rpc.list()` / the agent manifest surface
   devframe provides before inventing a new assertion path).
4. Re-run the full verification list in Step 6.

## Verification

All of Steps 1–6's individual checks, plus:

- `pnpm exec vp check` exits 0
- `pnpm run test:unit` exits 0
- `pnpm run build` exits 0
- `pnpm exec vp test run --project e2e timeline` exits 0
- `grep -n "StreamSink\|\.buffer\b" src/lib/devframe/definition.ts` has no
  matches
- `git status --porcelain` lists only the files in "Scope" (plus gitignored
  build output)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above do not match the live code (drift).
- You find yourself wanting to read `StreamSink.buffer` or `.events`
  directly instead of maintaining the ring buffer — that's the thing this
  plan explicitly avoids; stop and reconsider the design rather than reach
  for the internal field.
- You start implementing Step 8 without an explicit maintainer go-ahead
  recorded somewhere (a comment, a commit message, a linked decision) — back
  out and ship Steps 1–7 alone.
- The timeline e2e suite fails after your change but passed before it.

## Maintenance notes

- `RECENT_EVENTS_BUFFER_SIZE` and the streaming channel's `replayWindow: 512`
  are two independent constants that happen to share a value for now. If one
  changes, reconsider whether the other should too — they serve different
  consumers (agent queries vs. panel reconnect replay) and there's no
  requirement they stay equal.
- If a future change makes `TimelineEvent.time` anything other than
  recording-relative (see `clock.ts`), the `sinceMs` filter's "relative to
  the newest buffered event" logic in Step 3 must be revisited — it is
  correct only because every event in one buffer shares one clock domain.
