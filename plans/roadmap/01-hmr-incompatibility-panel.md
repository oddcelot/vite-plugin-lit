# Plan 01: Surface HMR-incompatibility reasons in the panel and to agents

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This plan supersedes item 2 ("Surface
> HMR-incompatibility diagnostics in the panel") under "Direction — options
> for the maintainer" in `advisor-plans/README.md`; update that entry to point
> here once this plan is picked up.
>
> **Drift check (run first)**:
> `git diff --stat 2889243..HEAD -- src/lib/runtime/patch.ts src/lib/devframe/definition.ts src/lib/devframe/protocol.ts src/lib/devframe/source.ts src/lib/devframe/vite.ts src/panel/components-view.ts src/panel/lit-devtools-panel.ts src/types/timeline.ts src/types/inspector.ts src/test/unit/patch_test.ts docs/src/content/docs/reference/limitations.mdx`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M — spans the browser runtime (`patch.ts`), the node-side
  devframe definition, two shared type modules, and two panel components.
  Every piece has a precedented pattern to copy (the inspector's
  cache-and-broadcast plumbing), but there is no way to land it as a single
  small diff.
- **Risk**: MEDIUM. The riskiest single line is a new `hot.send()` call added
  to `src/lib/runtime/patch.ts` immediately before `location.reload()` — see
  "Risks" below. Contained by keeping the change to that file to a single
  additive call with no new branching, and by an explicit manual check in
  Step 8.
- **Depends on**: `plans/devframe-foundation.md` phases 1–2 (done — the panel
  runs on devframe and exposes `agent`-described query RPCs already). Not
  dependent on phases 3–4 (in-page channel, CLI/static build).
- **Category**: feature
- **Planned at**: commit `2889243`, 2026-09-17

## Why this matters

The plugin's core promise is "HMR that keeps component state." When a
component can't be hot-patched in place, the browser runtime logs one line to
the console and then, by default, full-reloads the page — the developer loses
whatever state they were looking at and, in practice, never reads the console
line before the navigation clears it. `docs/src/content/docs/reference/limitations.mdx:10-13`
puts it plainly:

```
Each case below is detected deterministically — the plugin never guesses and
never leaves a component half-patched. What it does instead is governed by
[`hmr.onIncompatible`](/vite-plugin-lit/reference/options/#hmronincompatible):
reload the page (default) or warn in the console.
```

The reasons are already computed precisely in `src/lib/runtime/patch.ts`. This
plan pipes them to the one place a developer (or a coding agent driving the
dev server) is actually looking: the DevTools panel already built on devframe,
plus a new agent-facing query RPC. It also evaluates, per the advisor's
findings, whether devframe's structured-diagnostics facility (`nostics`) is
the right home for these reasons, and whether the panel should grow a fourth
tab to show them.

## Current state

### The three reasons, verified against the code

`docs/src/content/docs/reference/limitations.mdx:15-28` documents exactly
three "cannot be patched in place" cases. All three are real, and only two of
them go through the same code path:

**1. Standard `accessor` decorators** — detected ahead of time and routed
through `incompatible()`:

`src/lib/runtime/patch.ts:303-307`:

```ts
// 2. Standard-decorator `accessor` properties can't be patched in place.
if (usesStandardDecorators(NewClass)) {
  incompatible(state, record.tagName, 'standard accessor decorators');
  return;
}
```

**2. Native `#private` fields** (and any other in-place-patch failure) — not
detected ahead of time; caught generically when copying members throws, also
routed through `incompatible()`:

`src/lib/runtime/patch.ts:414-420`:

```ts
  } catch (e) {
    incompatible(
      state,
      record.tagName,
      `patching failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
```

This second call site is a catch-all, not a specific detector: its `reason`
string is whatever `Error.message` the JS engine produced (e.g. a brand-check
`TypeError` for `#private` access), not a fixed string like the first case.

**3. `observedAttributes` changes** — a materially different case: the patch
_succeeds_, nothing reloads, and the platform silently keeps observing the old
attribute list. This does **not** go through `incompatible()`:

`src/lib/runtime/patch.ts:364-372`:

```ts
if (
  oldObserved.length !== newObserved.length ||
  oldObserved.some((attr, i) => attr !== newObserved[i])
) {
  console.info(
    `[lit-plugin] <${record.tagName}> changed observedAttributes; the ` +
      `platform registry can't pick this up — reload recommended.`
  );
}
```

`incompatible()` itself, the shared sink for cases 1 and 2:

`src/lib/runtime/patch.ts:268-284`:

```ts
const incompatible = (
  state: PatchState,
  tagName: string,
  reason: string
): void => {
  if (state.options.onIncompatible === 'warn') {
    console.warn(
      `[lit-plugin] <${tagName}> can't be hot-patched (${reason}). ` +
        `Reload the page to pick up the change.`
    );
  } else {
    console.info(
      `[lit-plugin] <${tagName}>: ${reason} — performing full reload.`
    );
    location.reload();
  }
};
```

`onIncompatible` is a config-time default overridable live from the panel's
existing Settings tab (`src/panel/devtools-settings.ts:347-364`,
`src/types/timeline.ts:64` `FeatureSettings.hmr.onIncompatible`), and the unit
test suite always runs with `onIncompatible: 'warn'`
(`src/test/unit/patch_test.ts:78`), so `location.reload()` never actually
fires under test — this feature's runtime `hot.send()` addition (Step 2) is
therefore untested by the existing suite by construction, not by omission.

### `patch.ts` already talks to `import.meta.hot` — one direction only

`src/lib/runtime/patch.ts:25-26`:

```ts
/** Minimal `import.meta.hot` shape used to receive live setting overrides. */
type HotChannel = {on: (event: string, cb: (data: unknown) => void) => void};
```

`src/lib/runtime/patch.ts:453-460`:

```ts
// Let the DevTools panel override these behaviours live (and persist across
// reloads) on top of the config-time defaults above.
subscribeOverride((import.meta as {hot?: HotChannel}).hot, (o) => {
  if (o.hmrReconnect !== undefined) state.options.reconnect = o.hmrReconnect;
  if (o.hmrOnIncompatible !== undefined) {
    state.options.onIncompatible = o.hmrOnIncompatible;
  }
});
```

So `patch.ts` is not "dependency-free" in the sense of never touching
`import.meta.hot` — it already receives on it. It has never _sent_ on it. This
plan adds exactly one outbound `send()`, guarded by the same
`(import.meta as {hot?: HotChannel})` cast already in the file, keeping the
"dependency-free, no lit import" property intact (the type import added in
Step 1 is erased at compile time, like the existing `SettingsOverride` type
import in `src/lib/runtime/overrides.ts:13-17`).

### The inspector's cache-and-broadcast pattern (the template to copy)

The Components inspector already solves "push occasional, low-volume,
per-tag/per-element events from the page to node, cache the latest, let the
panel and an agent both read them" — this plan is the same shape applied to
incompatibility events instead of tree/details snapshots.

`src/lib/devframe/source.ts:28-33` (the sink interface to extend):

```ts
/** The definition's sink for events arriving from the page runtime. */
export interface TimelineSink {
  pushEvents(events: TimelineEvent[]): void;
  addLayer(layer: TimelineLayer): void;
  inspectorMessage(msg: InspectorMessage): void;
}
```

`src/lib/devframe/vite.ts:118-127` (the Vite bridge forwarding a page-runtime
HMR channel into the sink — the pattern the new channel copies):

```ts
hot.on(INSPECT_DATA_CHANNEL, (data: InspectorMessage) => {
  // An overlay pick means the developer clicked an element in the page and
  // wants the Components tab. Bring the dock forward from the node side
  // rather than having the panel reach into the parent frame.
  if (data.type === 'pick') {
    this.#hub?.docks?.activate?.(LIT_DEVFRAME_ID);
  }
  this.#sink?.inspectorMessage(data);
});
```

`src/lib/devframe/definition.ts:101-105` and `:141-157` (node-side cache plus
broadcast, the exact shape the new events will follow):

```ts
let cachedRoots: InspectorTreeNode[] = [];
const cachedDetails = new Map<number, InspectorDetails>();
```

```ts
          inspectorMessage(message) {
            if (message.type === 'tree') {
              cachedRoots = message.roots;
            } else if (message.type === 'details') {
              cachedDetails.set(message.details.id, message.details);
            } else if (message.type === 'gone') {
              cachedDetails.delete(message.id);
            }
            void ctx.rpc.broadcast({
              method: `${LIT_DEVFRAME_ID}:${RPC_INSPECTOR_MESSAGE}`,
              args: [message],
              optional: true,
            });
          },
```

`src/lib/devframe/definition.ts:195-206` (a `type: 'query'` RPC with an
`agent` description — the template for the new agent tool; note it says WHEN
to call it, matching the tone this plan must follow):

```ts
my.rpc.register(
  defineRpcFunction({
    name: RPC_LIST_COMPONENTS,
    type: 'query',
    jsonSerializable: true,
    agent: {
      description:
        'List the live Lit component tree of the inspected page. Call this before asking about a specific element to find its id.',
    },
    handler: async (): Promise<InspectorTreeNode[]> => cachedRoots,
  })
);
```

`src/panel/components-view.ts:254-268` (panel-side: registering a node→panel
push, then priming from the cache on connect — the template for the panel
banner's data layer):

```ts
  private async _connect(): Promise<void> {
    try {
      const rpc = await litRpc();
      this._rpc = rpc;
      rpc.rpc.register({
        name: 'inspector-message',
        type: 'event',
        handler: this._onMessage,
      });
      this._roots = await rpc.rpc.call('list-components');
      void rpc.rpc.call('inspect', {type: 'tree'});
    } catch (err) {
      this._error = describeError(err);
    }
  }
```

### The panel's three existing tabs

`src/panel/lit-devtools-panel.ts:36-40`:

```ts
const TABS: readonly TabItem[] = [
  {id: 'components', label: 'Components', icon: CUBE_ICON},
  {id: 'timeline', label: 'Timeline', icon: CLOCK_ICON},
  {id: 'settings', label: 'Settings', icon: GEAR_ICON},
];
```

`advisor-plans/README.md:76-86` (the finding this plan supersedes) flagged
"more surface in a panel that already has three tabs" as the trade-off of this
feature.

### Why the Timeline tab's existing event stream is the wrong transport

The Timeline tab's stream is gated on a recording flag the developer toggles
per capture layer, and the gate lives entirely in the _page runtime_, not the
transport:

`src/lib/runtime/timeline/install.ts:54-57`:

```ts
installLifecycleLayer(emit, recording, lifecycleEnabled);
installRenderLayer(emit, recording, renderEnabled);
installMouseLayer(emit, recording, mouseEnabled);
installKeyboardLayer(emit, recording, keyboardEnabled);
```

Each capture layer, not `transport.ts` or the node side, decides whether to
call `emit()` at all. An HMR-incompatibility event must reach the panel and an
agent regardless of whether the developer happens to have hit "record" — most
won't have, since a failed hot-patch is not something anyone anticipates.
Routing through `addTimelineEvent()` (`src/lib/runtime/timeline/public-api.ts:32-34`)
would also require `patch.ts` to import from `src/lib/runtime/timeline/`,
which is only injected into the page when `timeline: true`
(`src/lib/plugin.ts:870-878`) — coupling the always-on HMR patcher to an
optional add-on module it does not otherwise depend on. The inspector's
`INSPECT_DATA_CHANNEL` pattern above has neither problem: it is a dedicated,
always-on channel, independent of the recording flag, and the coupling to
`timeline: true` happens once, at the plugin-config layer
(`src/lib/plugin.ts:903-908`, `createLitDevframePlugin` is only mounted `if
(resolved.timeline)`), exactly the same place the Components inspector's RPCs
already live. This plan accepts that same dependency — the feature only works
with `timeline: true` — because it is already true for every other DevTools
surface, not because of anything new added here.

### `ctx.diagnostics` — what it actually offers

Read from the installed package (`devframe@1.0.0`, resolved via
`node_modules/.pnpm/devframe@1.0.0_.../node_modules/devframe/dist/context--tVkJw3W.d.mts`
— a build-hashed filename that will differ across installs; the API it types,
`ctx.diagnostics` / `defineDiagnostics()` / `DiagnosticHandle`, is the stable,
documented surface at https://devfra.me/guide/diagnostics):

```ts
interface DevframeDiagnosticsHost {
  readonly logger: DevframeDiagnosticsLogger; // Proxy: host.logger.CODE(params)
  register: (definitions: Record<string, unknown>) => void;
  defineDiagnostics: typeof defineDiagnostics;
}
```

and from `nostics`'s own types
(`node_modules/.pnpm/nostics@1.2.0/node_modules/nostics/dist/diagnostic-wduO7saY.d.mts:222-229`):

```ts
interface DiagnosticHandle<Params, ReporterOpts> {
  (...args: ActionArgs<Params, ReporterOpts>): Diagnostic;
}
```

Each code is a **callable that builds an `Error` subclass and runs reporters
(by default, devframe's ANSI console reporter — i.e. it prints to the
terminal running the dev server)**. There is no `list()`, no history, no
query method, and nothing exposed over RPC — `ctx.diagnostics` is fire-and-log,
not fire-and-store. It cannot be the backing store for "what reasons fired
this session" (that has to be the cache in `definition.ts`, per the pattern
above), and using it as one would be the wrong tool for the job.

Where it _does_ help: coding agents and CI logs commonly see the dev server's
stdout but not the browser console (where `patch.ts`'s existing
`console.info`/`console.warn` already print) and not the panel. Firing one
`ctx.diagnostics.logger.<CODE>({tagName})` call from the same sink handler
that populates the cache gives that audience a coded, docs-linked line in the
terminal, for the cost of one `defineDiagnostics()` call and one call site.
This plan includes it as a small, cuttable addition (Step 6b) — not the
primary vehicle for the feature — since it only adds a second, redundant
notification surface for anyone who already has the browser console or the
panel open.

## Decisions

1. **Channel + `TimelineSink` extension, not the existing timeline event
   stream.** The Timeline tab's stream is per-capture-layer recording-gated
   and would either silently drop incompatibility events (recording off, the
   common case) or require coupling `patch.ts` to the optional
   `timeline: true` runtime module it does not otherwise import. A dedicated
   channel mirroring `INSPECT_DATA_CHANNEL` has neither problem.
2. **A banner/section inside the existing Components tab, not a new tab**,
   plus a small unread-count badge on the tab strip itself so it's visible
   from Timeline/Settings too. An incompatibility event is about one specific
   custom element failing to hot-patch — exactly what the Components tab is
   for — and the advisor's own finding already flagged tab sprawl as this
   panel's cost to watch.
3. **A cache + broadcast + `type: 'query'` RPC (the inspector's pattern), not
   a new `rpc.streaming` channel.** `plans/devframe-foundation.md`'s own
   "Decisions" section reserves streaming for high-volume data ("Timeline
   volume ... would thrash Immer patches"); incompatibility events are rare
   (ideally zero per session), so the lighter cache-and-broadcast pattern
   already used for `list-components`/`component-details` fits better and
   reuses more code.
4. **`ctx.diagnostics` is a nice-to-have terminal echo, not the storage
   layer.** It has no read-back API, so the cache above has to exist
   regardless; wiring `ctx.diagnostics` on top costs one extra call per event
   and helps agents that only see dev-server stdout. Cut it first if scope
   needs to shrink.

## Data shapes

New file `src/types/hmr-incompatibility.ts` (mirrors the shape and license
header of `src/types/inspector.ts`):

```ts
/** Why a component couldn't be hot-patched in place, or a related silent case. */
export type HmrIncompatibilityReason =
  | {code: 'accessor-decorators'}
  | {code: 'patch-failed'; detail: string}
  | {code: 'observed-attributes-changed'};

/**
 * One HMR-incompatibility notice from the page runtime. `action` reflects
 * what actually happened for *this* event, not just the configured default:
 * 'reload' / 'warn' come from `hmr.onIncompatible`; 'none' is the
 * `observed-attributes-changed` case, which never reloads regardless of that
 * setting (the patch already succeeded).
 */
export interface HmrIncompatibilityEvent {
  tagName: string;
  /** `Date.now()` in the browser — there is no shared clock with the timeline's `performance.now()`. */
  time: number;
  reason: HmrIncompatibilityReason;
  action: 'reload' | 'warn' | 'none';
}

/** HMR channel the page runtime uses to report an {@link HmrIncompatibilityEvent}. */
export const HMR_INCOMPATIBLE_CHANNEL = 'lit:hmr:incompatible';
```

Reused, not reinvented: `TimelineSink`/`TimelineSource` from
`src/lib/devframe/source.ts`, the `defineRpcFunction`/`agent` pattern from
`src/lib/devframe/definition.ts`, the `DevframeRpcServerFunctions` /
`DevframeRpcClientFunctions` augmentation pattern from
`src/lib/devframe/protocol.ts:134-156`, and the panel's `litRpc()` /
`describeError()` from `src/panel/client.ts`.

## Commands you will need

| Purpose                | Command                                        | Expected on success                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install                | `pnpm install`                                 | exit 0                                                                                                                                                                                       |
| Format/lint/types      | `pnpm exec vp check`                           | exit 0                                                                                                                                                                                       |
| Unit tests             | `pnpm run test:unit`                           | exit 0                                                                                                                                                                                       |
| Build                  | `pnpm run build`                               | exit 0                                                                                                                                                                                       |
| Timeline/inspector e2e | `pnpm exec vp test run --project e2e timeline` | exit 0 (slow) — matches `timeline_test.ts`, `input-timeline_test.ts`, `lifecycle-timeline_test.ts`; there is no separate `inspect_test.ts` file, inspector coverage lives inside these three |

## Scope

**In scope**:

- `src/types/hmr-incompatibility.ts` (new)
- `src/lib/runtime/patch.ts` (additive: structured reason + one `hot.send()`)
- `src/lib/devframe/source.ts`, `definition.ts`, `protocol.ts`, `vite.ts`
- `src/panel/components-view.ts`, `src/panel/lit-devtools-panel.ts`
- `src/test/unit/patch_test.ts` (new assertions on the existing tests)
- `docs/src/content/docs/reference/limitations.mdx` (cross-link, small)
- `advisor-plans/README.md` (mark item 2 as superseded by this plan)

**Out of scope**:

- Changing what `incompatible()` decides to do (reload vs warn) — this plan
  only reports the decision already made, it does not add new logic to
  `src/lib/runtime/patch.ts` beyond the report call.
- A "clear history" action or persistence across dev-server restarts for the
  incompatibility cache — v1 is in-memory, capped, per session, matching
  `cachedDetails` today.
- `plans/devframe-foundation.md` phases 3–4 (in-page channel, static build) —
  unaffected by this plan.

## Git workflow

- Branch: `roadmap/01-hmr-incompatibility-panel`
- Commit message style: capitalized imperative summary, no
  conventional-commit prefix (e.g. `Surface HMR-incompatibility reasons in the panel`).
- Do NOT push or open a PR without being asked.

## Steps

### Step 1: Add the shared types module

Create `src/types/hmr-incompatibility.ts` with the `HmrIncompatibilityReason`,
`HmrIncompatibilityEvent`, and `HMR_INCOMPATIBLE_CHANNEL` shapes from "Data
shapes" above. Match the license header and doc-comment style of
`src/types/inspector.ts:1-21`.

**Verify**: `pnpm exec vp check` → exit 0.

### Step 2: Thread a structured reason through `patch.ts`

In `src/lib/runtime/patch.ts`:

1. Widen the local `HotChannel` type (`:26`) to add `send`:
   ```ts
   type HotChannel = {
     on: (event: string, cb: (data: unknown) => void) => void;
     send: (event: string, data: unknown) => void;
   };
   ```
2. Add a `hot?: HotChannel` field to `PatchState` (alongside `records`,
   `generationOf`, `options`), populated in `install()` from the same
   `(import.meta as {hot?: HotChannel}).hot` already read at `:455`.
3. Change `incompatible()`'s third parameter from `reason: string` to
   `reason: HmrIncompatibilityReason`, and derive the human-readable text
   from it for the _existing_ `console.warn`/`console.info` strings — do not
   change their wording, `src/test/unit/patch_test.ts:464-466` asserts on
   `'standard accessor decorators'` verbatim:
   ```ts
   const describeReason = (r: HmrIncompatibilityReason): string =>
     r.code === 'accessor-decorators'
       ? 'standard accessor decorators'
       : r.code === 'patch-failed'
         ? `patching failed: ${r.detail}`
         : "observedAttributes changed; the platform registry can't pick this up";
   ```
4. Inside `incompatible()`, after computing the message and before
   `location.reload()` (send before reload — see "Risks"), send the event:
   ```ts
   state.hot?.send(HMR_INCOMPATIBLE_CHANNEL, {
     tagName,
     time: Date.now(),
     reason,
     action: state.options.onIncompatible === 'warn' ? 'warn' : 'reload',
   } satisfies HmrIncompatibilityEvent);
   ```
5. Update the two `incompatible()` call sites:
   - `:305` → `incompatible(state, record.tagName, {code: 'accessor-decorators'});`
   - `:415-419` → `incompatible(state, record.tagName, {code: 'patch-failed', detail: e instanceof Error ? e.message : String(e)});`
6. At the `observedAttributes` site (`:364-372`), after the existing
   `console.info`, add the same report with `action: 'none'` (this path never
   calls `incompatible()`, so it needs its own `state.hot?.send(...)` with
   `reason: {code: 'observed-attributes-changed'}`).

Import only the two types and the one constant from
`../../types/hmr-incompatibility.js` — a type-only import (erased) plus one
string constant, matching how `src/lib/runtime/overrides.ts:13-17` already
imports from `../../types/timeline.js` without violating the "dependency-free,
no lit import" property.

**Verify**:

- `pnpm exec vp check` → exit 0.
- `pnpm run test:unit` → exit 0 (the existing "bails out" test at
  `src/test/unit/patch_test.ts:431-471` must keep passing unchanged, since the
  console text is preserved).

### Step 3: Extend the `TimelineSink` port

In `src/lib/devframe/source.ts`, add one method to `TimelineSink`
(`:29-33`):

```ts
export interface TimelineSink {
  pushEvents(events: TimelineEvent[]): void;
  addLayer(layer: TimelineLayer): void;
  inspectorMessage(msg: InspectorMessage): void;
  hmrIncompatible(event: HmrIncompatibilityEvent): void;
}
```

`createNullSource()` (`:52-63`) does not change — `TimelineSink` is
implemented by the _consumer_ (`definition.ts`), not by `TimelineSource`.

**Verify**: `pnpm exec vp check` → exit 0 (will fail until Step 5 implements
the new method — expected at this point; proceed to Step 4).

### Step 4: Forward the new channel in the Vite bridge

In `src/lib/devframe/vite.ts`, inside `HotTimelineSource.bind()`
(`:105-128`), add one more `hot.on(...)` alongside the three existing ones,
following the exact shape of `:110-117`:

```ts
hot.on(HMR_INCOMPATIBLE_CHANNEL, (event: HmrIncompatibilityEvent) => {
  this.#sink?.hmrIncompatible(event);
});
```

No dock-activation call here (unlike the inspector's `pick` case at
`:123-124`) — an incompatibility is informational, not a request to switch
tabs; Step 7's badge handles visibility instead.

**Verify**: `pnpm exec vp check` → exit 0.

### Step 5: Cache, broadcast, and register the query RPC

In `src/lib/devframe/protocol.ts`:

- Add bare names `RPC_HMR_INCOMPATIBILITIES = 'hmr-incompatibilities'`
  (query) and `RPC_HMR_INCOMPATIBLE = 'hmr-incompatible'` (client push),
  next to the existing `RPC_*` constants (`:47-69`).
- Augment `DevframeRpcServerFunctions` and `DevframeRpcClientFunctions`
  (`:134-149`):
  ```ts
  interface DevframeRpcServerFunctions {
    // … existing …
    'lit:hmr-incompatibilities': () => Promise<HmrIncompatibilityEvent[]>;
  }
  interface DevframeRpcClientFunctions {
    // … existing …
    'lit:hmr-incompatible': (event: HmrIncompatibilityEvent) => void;
  }
  ```

In `src/lib/devframe/definition.ts`, inside `setup()`:

- Add a capped array next to `cachedRoots`/`cachedDetails` (`:104-105`):
  ```ts
  const MAX_HMR_INCOMPATIBILITIES = 50;
  const hmrIncompatibilities: HmrIncompatibilityEvent[] = [];
  ```
  Cap it the same way `src/lib/runtime/timeline/transport.ts:100-102` caps
  its pending queue (`splice` off the oldest when over the limit), not an
  unbounded push — a long session with many failing edits must not grow this
  forever.
- Add `hmrIncompatible(event)` to the `source.attach({...})` sink object
  (`:127-158`), alongside `pushEvents`/`addLayer`/`inspectorMessage`:
  ```ts
  hmrIncompatible(event) {
    hmrIncompatibilities.push(event);
    if (hmrIncompatibilities.length > MAX_HMR_INCOMPATIBILITIES) {
      hmrIncompatibilities.splice(
        0,
        hmrIncompatibilities.length - MAX_HMR_INCOMPATIBILITIES
      );
    }
    void ctx.rpc.broadcast({
      method: `${LIT_DEVFRAME_ID}:${RPC_HMR_INCOMPATIBLE}`,
      args: [event],
      optional: true,
    });
  },
  ```
- Register the query RPC, following `RPC_LIST_COMPONENTS`'s shape
  (`:195-206`) exactly, including an `agent` description that says WHEN to
  call it (matching the tone of the other three):
  ```ts
  my.rpc.register(
    defineRpcFunction({
      name: RPC_HMR_INCOMPATIBILITIES,
      type: 'query',
      jsonSerializable: true,
      agent: {
        description:
          "List recent components the Lit plugin could not hot-patch in place, and why. Call this after an unexplained full-page reload during development, or when a component's state resets unexpectedly on edit.",
      },
      handler: async (): Promise<HmrIncompatibilityEvent[]> =>
        hmrIncompatibilities,
    })
  );
  ```
  No `snapshot: true` — like `list-components`/`component-details`, this is
  live session data with no meaningful value in a static build snapshot.

**Verify**: `pnpm exec vp check` → exit 0.

### Step 6a: Panel — Components tab banner + tab badge

In `src/panel/components-view.ts`:

- Register the `hmr-incompatible` client push in `_connect()`
  (`:254-268`), alongside the existing `inspector-message` registration, and
  prime from the cache the same way `_roots` is primed:
  ```ts
  rpc.rpc.register({
    name: 'hmr-incompatible',
    type: 'event',
    handler: this._onHmrIncompatible,
  });
  this._hmrIncompatibilities = await rpc.rpc.call('hmr-incompatibilities');
  ```
- Render a collapsible section above the existing tree/details layout when
  `this._hmrIncompatibilities.length > 0`: for each event, the tag name, the
  human-readable reason (reuse `describeReason`-equivalent text — see Step 6c
  on where that text should live so it isn't duplicated), a relative
  timestamp, and (for `action !== 'none'`) whether it reloaded or only
  warned. Style the section with the existing `--lit-devtools-error` token
  (already used at `src/panel/timeline-event-list.ts:60` for a comparable
  "something's wrong" indicator) rather than introducing a new color.

In `src/panel/lit-devtools-panel.ts`:

- Give `ComponentsView` a small `count` property (or a getter over its
  cached list) and render a badge on the "Components" tab item when count
  `> 0`, so the notice is visible even while parked on Timeline or Settings —
  the same cross-tab-visibility need `_onInspectorActivate` (`:142-144`)
  already solves for overlay picks, but as a passive badge instead of an
  active tab switch (an incompatibility is not something the developer asked
  to look at, unlike a pick).

**Verify**: `pnpm exec vp check` → exit 0. Manual verification is in Step 8 —
this repo has no component-level tests for the panel today (`advisor-plans/README.md`
finding H), so do not invent a new panel test harness here; that is a
separate, larger piece of work.

### Step 6b (optional, cut first if scope needs to shrink): terminal echo via `ctx.diagnostics`

In `src/lib/devframe/definition.ts`, once per `setup()`:

```ts
const hmrDiagnostics = ctx.diagnostics.defineDiagnostics({
  docsBase: 'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/',
  codes: {
    LIT_HMR_ACCESSOR: {
      why: (p: {tagName: string}) =>
        `<${p.tagName}> can't be hot-patched: standard accessor decorators`,
      docs: 'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/#cannot-be-patched-in-place',
    },
    LIT_HMR_PATCH_FAILED: {
      why: (p: {tagName: string; detail: string}) =>
        `<${p.tagName}> can't be hot-patched: ${p.detail}`,
      docs: 'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/#cannot-be-patched-in-place',
    },
    LIT_HMR_ATTRS_CHANGED: {
      why: (p: {tagName: string}) =>
        `<${p.tagName}> changed observedAttributes; reload recommended`,
      docs: 'https://oddcelot.github.io/vite-plugin-lit/reference/limitations/#cannot-be-patched-in-place',
    },
  },
});
ctx.diagnostics.register(hmrDiagnostics);
```

then, inside the `hmrIncompatible(event)` sink handler from Step 5, fire the
matching code (no `throw` — this is informational, not an error to
propagate):

```ts
if (event.reason.code === 'accessor-decorators') {
  hmrDiagnostics.LIT_HMR_ACCESSOR({tagName: event.tagName});
} else if (event.reason.code === 'patch-failed') {
  hmrDiagnostics.LIT_HMR_PATCH_FAILED({
    tagName: event.tagName,
    detail: event.reason.detail,
  });
} else {
  hmrDiagnostics.LIT_HMR_ATTRS_CHANGED({tagName: event.tagName});
}
```

The docs anchor points at the `## Cannot be patched in place` heading, the
finest-grained anchor Starlight generates — the three bullets underneath are
not individually anchorable without restructuring the doc, which is out of
scope here.

**Verify**: `pnpm exec vp check` → exit 0.

### Step 6c: Share the reason-text formatter

`describeReason()` (Step 2) is needed in two places (the browser console
message and, ideally, the panel banner's copy) but must not be duplicated by
hand in both, or the two will drift. Since the panel cannot import
`src/lib/runtime/patch.ts` (browser-runtime internals, not exported), export
a small `describeHmrReason(reason: HmrIncompatibilityReason): string`
function from the new `src/types/hmr-incompatibility.ts` module instead, and
have both `patch.ts`'s `describeReason` (Step 2) and the panel banner
(Step 6a) call it. `src/lib/runtime/patch.ts` may keep its own thin wrapper
if the exact console-string wording needs to differ slightly from the panel's
copy; if it does not need to differ, delete the local `describeReason` and
call the shared one directly.

**Verify**: `pnpm exec vp check` → exit 0; `grep -n "describeReason" src/lib/runtime/patch.ts` shows at most a thin wrapper, not a second copy of the three-way branch.

### Step 7: Cross-link the docs (small)

In `docs/src/content/docs/reference/limitations.mdx`, add one sentence to the
"Which one fired?" section (`:48-52`) noting that the DevTools panel's
Components tab now lists these events directly, so a developer doesn't have
to chase the console message before a reload clears it.

**Verify**: `pnpm exec docs build` if the docs site has its own build script
(check `docs/package.json`); otherwise a plain read-through is sufficient —
do not block this plan on the Starlight build if it is not already wired
into `vp check`.

### Step 8: Manual confirmation of the reload race (required, not optional)

`incompatible()` now sends over the HMR WebSocket and then, in the same
synchronous call, may invoke `location.reload()`. Browsers do not block
`location.reload()` on network flushes, so verify by hand rather than by
inference:

1. `pnpm run dev`, open Vite DevTools, Components tab.
2. Edit a playground component to add a standard `accessor` reactive
   property (triggers case 1) and save.
3. Confirm the panel's new banner shows the event _after_ the reload
   completes (i.e. the node-side cache actually received it before the page
   navigated away).
4. Repeat with `hmr.onIncompatible: 'warn'` (no reload) to confirm the
   non-reload path also delivers the event, as a control.
5. **Revert any playground edit you made** — `git checkout -- playground/src`
   before finishing.

If step 3 shows the event is lost on the reload path specifically (but not on
the warn path), that confirms the race is real; see STOP conditions.

**Verify**: `git status --porcelain` shows no modification under
`playground/`.

## Test plan

- `src/test/unit/patch_test.ts`: extend the existing "bails out" test
  (`:431-471`) to also assert the sent payload's `reason.code`, by stubbing
  `import.meta.hot` for that test only (check whether the project's Vitest
  config already supports this via `vi.stubGlobal` or an environment flag —
  if not, add a minimal fake consistent with the file's existing
  characterization-harness style, not a new dependency). If stubbing
  `import.meta.hot` proves impractical in this test file's environment
  (Node/Vitest, not a real Vite dev transform), refactor the event-building
  logic (tagName/reason/action → `HmrIncompatibilityEvent`) into a small pure
  function that _is_ unit-testable without touching `import.meta.hot`, and
  leave the actual `.send()` wiring to the manual check in Step 8 — the same
  scoping call plan 004 made for its own hard-to-test path.
- No new panel test harness — matches this repo's existing gap (finding H)
  and plan 004's precedent of not inventing one for a single feature.
- Step 8's manual reload-race check is the only verification of the riskiest
  line in this plan; do not skip it.

## Done criteria

ALL must hold:

- [ ] `pnpm exec vp check` exits 0
- [ ] `pnpm run test:unit` exits 0
- [ ] `pnpm run build` exits 0
- [ ] `pnpm exec vp test run --project e2e timeline` exits 0
- [ ] The three reasons (`accessor-decorators`, `patch-failed`,
      `observed-attributes-changed`) each reach the panel's Components tab
      banner and `lit:hmr-incompatibilities` query, verified manually per
      Step 8
- [ ] Existing console wording in `src/lib/runtime/patch.ts` is byte-for-byte
      unchanged (verified by the untouched assertion in
      `src/test/unit/patch_test.ts:464-466`)
- [ ] `advisor-plans/README.md` item 2 marked superseded by this plan
- [ ] `git status --porcelain` lists no modification under `playground/`

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above do not match the live code (drift).
- Step 8 shows the reload path genuinely drops the event (the WS send loses
  the race with `location.reload()`). Do not paper over this with a
  `setTimeout` delay before reloading — that reintroduces the exact
  state-loss window this plugin exists to avoid. Report the finding; the fix
  (e.g. an `ack`-based send, or accepting that only the `'warn'` path is
  reliable) needs a design decision, not an executor's judgment call.
- You find a fourth `incompatible()`-shaped case not covered by the three
  reasons in `docs/src/content/docs/reference/limitations.mdx:15-28` — add it
  to `HmrIncompatibilityReason` rather than dropping it, but note it in your
  report since it means the docs page is also stale.
- Extending `TimelineSink` (Step 3) requires touching `pushEvents` or
  `addLayer`'s existing signatures — this plan is additive only; a required
  change to the existing methods means the port's shape needs re-review
  before continuing.

## Risks

- **Reload-ordering race** (see Step 8 and STOP conditions) — the main
  technical risk in this plan. Every other change here is inert unless this
  one holds up.
- **`patch.ts` is "the most safety-critical file in the package"**
  (`advisor-plans/004-watch-stale-lifecycle.md:167-169`, in the context of a
  different plan explicitly avoiding new hooks into it). This plan does add
  to it, unlike plan 004 — keep the addition to exactly one new field, one
  parameter-type change, and one `send()` call; do not restructure
  `hotPatch()` or `incompatible()`'s control flow beyond that.
- **Unbounded cache growth** if `MAX_HMR_INCOMPATIBILITIES` is omitted or set
  too high in a long-running session with many failing edits — mitigated by
  the explicit cap in Step 5, sized the same way `transport.ts`'s
  `MAX_PENDING` is.
- **Redundant notification surfaces**: browser console (existing),
  terminal (Step 6b, optional), and panel banner (Step 6a) all say roughly
  the same thing for one event. This is intentional (three different
  audiences: the developer watching the page, an agent watching stdout, a
  developer watching the panel) but is exactly the kind of thing that reads
  as noisy if the wording isn't kept consistent — hence Step 6c's shared
  formatter.

## Maintenance notes

- Any future third case added to `incompatible()`'s call sites in
  `src/lib/runtime/patch.ts` must also extend `HmrIncompatibilityReason` in
  `src/types/hmr-incompatibility.ts` and `describeHmrReason()` — the STOP
  condition above exists to catch this plan's own blind spots, but a reviewer
  should apply the same rule to any later change.
- If `plans/devframe-foundation.md` phase 3 (in-page channel) lands, this
  feature's channel does not need to move — it is page→node only, one-way,
  and low-volume, unlike the pick/highlight loops phase 3 targets.
