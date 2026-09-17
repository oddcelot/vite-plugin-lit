# Plan 06: Persist panel settings through devframe (keep `localStorage` as the boot cache)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/roadmap/README.md` (`06 | Persist panel settings per project`).
>
> **Drift check (run first)**:
> `git diff --stat 2889243..HEAD -- src/types/timeline.ts src/panel/devtools-settings.ts src/lib/color-scheme.ts src/lib/runtime/overrides.ts src/lib/devframe/protocol.ts src/lib/devframe/definition.ts src/lib/devframe/vite.ts src/panel/client.ts`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3 (roadmap DX-impact: MED)
- **Effort**: S–M. S for the appearance/editor settings move; M if layer
  toggles are also migrated (this plan recommends **not** migrating those —
  see "Decisions")
- **Risk**: MED. The startup path this plan must not break
  (`src/lib/runtime/overrides.ts`) runs in every inspected page, with or
  without DevTools open — a mistake here is not confined to the panel
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `2889243`, 2026-09-17

## Why this matters

`plans/roadmap/README.md:21` and `:58` describe this as "06 stops settings
from being per-browser." Today, every persisted panel setting — HMR override
flags, the source-overlay editor choice, the panel's own color-scheme
preference — lives in `localStorage`, scoped to one browser origin. Open the
same dev server from a second machine, a second browser, or after clearing
site data, and every override is gone; there is no server-side memory of "what
this project's settings should be" at all. `get-meta`
(`src/lib/devframe/definition.ts:171-193`) only ever returns the **resolved
config** (`options` → env → defaults), never a previously-set override.

Devframe's per-scope settings store
(`ctx.scope('lit').settings.project` / `.global`, node side;
`client.scope('lit').settings`, browser side) is file-backed and would give
this project (or this developer) real memory of these choices across
browsers and dev-server restarts — the first time that's been possible.

## Current state

### The stub already in the codebase

`src/lib/devframe/protocol.ts:151-155` already augments the registry — this is
the "stub" this plan is meant to fill in, not create from scratch:

```ts
declare module 'devframe' {
  // ...
  interface DevframeSettingsRegistry {
    lit: {
      appearance?: 'auto' | 'dark' | 'light';
    };
  }
}
```

It is currently **dead**: `grep -rn "appearance" src` (excluding CSS
`appearance: none` declarations at `devtools-settings.ts:84` and
`segmented-tabs.ts:36`, which are unrelated) turns up nothing that reads or
writes `settings.lit.appearance` anywhere in `definition.ts`,
`devtools-settings.ts`, or elsewhere. Nothing calls
`ctx.scope('lit').settings` or `client.scope('lit').settings` today.

### The real `DevframeSettings` API

`node_modules/devframe/dist/context--tVkJw3W.d.mts:790-816`:

```ts
interface DevframeSettingsStore<
  T extends Record<string, any> = Record<string, any>,
> {
  get: <K extends keyof T>(key: K) => Promise<T[K] | undefined>;
  set: <K extends keyof T>(key: K, value: T[K]) => Promise<void>;
  delete: <K extends keyof T>(key: K) => Promise<void>;
  all: () => Promise<Readonly<T>>;
  onChange: (fn: (value: Readonly<T>) => void) => Promise<() => void>;
}
/**
 * The two settings scopes available on a scoped context.
 *
 *   - `project`: per-workspace state, persisted under the host's
 *     `workspace` storage dir. Project-local settings.
 *   - `global`:  per-user state, persisted under the host's `global`
 *     storage dir. Machine-wide preferences.
 */
interface DevframeSettings<
  T extends Record<string, any> = Record<string, any>,
> {
  global: DevframeSettingsStore<T>;
  project: DevframeSettingsStore<T>;
}
```

**Read this carefully — the naming is a trap.** `DevframeSettings.project`
does _not_ map to the storage scope literally named `'project'`. Per
`DevframeHost.getStorageDir`'s doc (`context--tVkJw3W.d.mts:471-493`):

- storage scope `'workspace'` → `${workspaceRoot}/.devframe/`, **"state
  shared with the whole team through version control ... hosts must place it
  somewhere committable."**
- storage scope `'project'` → `${cwd}/node_modules/.<appName>/devframe/`,
  **"per-checkout private state (caches, personal settings)," gitignored by
  virtue of living inside `node_modules`.**
- storage scope `'global'` → `${homedir()}/.<appName>/devframe/`, per-user.

And `DevframeSettings`'s own doc comment says its `project` field is
"persisted under the host's **`workspace`** storage dir" — i.e.
`ctx.scope('lit').settings.project` is the **committable, team-shared** one,
despite the name suggesting "private to my checkout." `.global` is the
per-user one, matching `localStorage`'s current per-browser scope far more
closely. Confirm this reading holds for the installed `devframe@1.0.0` before
writing any settings — if a future devframe release changes this mapping, the
excerpt above is what to re-check against.

Both node (`ctx.scope(ns).settings`, `context--tVkJw3W.d.mts:920-921`) and
browser (`client.scope(ns).settings`,
`node_modules/devframe/dist/client/index.d.mts:185-186`) expose the identical
shape, typed via `SettingsForNamespace<'lit'>` — i.e. once the
`DevframeSettingsRegistry.lit` augmentation above is used for real, both sides
get the same typed store with no extra wiring.

### The current bridge: `localStorage` + a live HMR push

`src/types/timeline.ts:78-96` documents the design:

```ts
/**
 * Runtime overrides the panel applies on top of the resolved env config...
 * Persisted under {@link SETTINGS_OVERRIDE_LS_KEY} (the panel and app share an
 * origin) so overrides survive reloads, and pushed live over
 * {@link SETTINGS_OVERRIDE_CHANNEL} via Vite HMR for immediate effect.
 */
export interface SettingsOverride {
  hmrReconnect?: boolean;
  hmrOnIncompatible?: 'reload' | 'warn';
  hmrIndicatorVisible?: boolean;
  hmrIndicatorCount?: boolean;
  sourceOverlayEditor?: string;
}
export const SETTINGS_OVERRIDE_LS_KEY = 'lit-devtools-overrides';
export const SETTINGS_OVERRIDE_CHANNEL = 'lit-devtools:settings-override';
```

The panel (`src/panel/devtools-settings.ts:178-186, 204-213`) reads/writes
`localStorage` directly and separately calls the `set-settings-override` RPC
action (`devtools-settings.ts:245-251`, handler at `definition.ts:271-280`)
which forwards to the page over Vite's `hot` channel
(`src/lib/devframe/vite.ts:161-163`, `HotTimelineSource.setSettingsOverride`).

**The page-runtime side is the load-bearing part.**
`src/lib/runtime/overrides.ts:24-48`:

```ts
export const readOverride = (): SettingsOverride => {
  try {
    const raw = localStorage.getItem(SETTINGS_OVERRIDE_LS_KEY);
    if (raw !== null) return JSON.parse(raw) as SettingsOverride;
  } catch {
    /* ... */
  }
  return {};
};

export const subscribeOverride = (
  hot: Hot,
  apply: (override: SettingsOverride) => void
): void => {
  apply(readOverride()); // <-- synchronous, at call time
  hot?.on(SETTINGS_OVERRIDE_CHANNEL, (data) =>
    apply((data ?? {}) as SettingsOverride)
  );
};
```

`subscribeOverride` is called **synchronously, at `connectedCallback` /
module-init time**, before any HMR event has arrived, from three independent
runtime modules:

- `src/lib/runtime/indicator.ts:138` (HMR indicator visibility/count)
- `src/lib/runtime/patch.ts:455` (HMR reconnect / onIncompatible behavior)
- `src/lib/runtime/source-overlay/overlay-element.ts:112`
  (`sourceOverlayEditor`)

None of these three modules holds — or can hold — a `DevframeRpcClient`. Per
`plans/devframe-foundation.md`'s "Page runtime ↔ node transport" section, the
inspected page only gets a devframe client in **phase 3** ("in-page channel"),
not yet built; today its only transport is `import.meta.hot`. Even if that
changed, `DevframeSettingsStore.get`/`.all` are **`Promise`-returning** — there
is no synchronous read path devframe offers, ever, by design (the comment at
`context--tVkJw3W.d.mts:787-789` says so explicitly: "Every method is async
because the underlying shared state is resolved lazily on first access").

**Conclusion, stated plainly since the prompt asked for verification, not
assumption: `SETTINGS_OVERRIDE_LS_KEY` cannot be removed.** It is the only
mechanism that lets these three modules apply a persisted preference
synchronously, before any connection — devframe or Vite HMR — is guaranteed to
exist, and it is the _only_ mechanism at all when `timeline: false` (no
devframe hub is even installed then, per `src/lib/plugin.ts:903-911`, covered
in more depth in plan 05). Any plan that deletes it without replacing the
startup path with something else synchronous is a regression, not a cleanup.

### Appearance/color-scheme today

`src/lib/color-scheme.ts:20-53` is a **separate, already-working** mechanism,
with its own `localStorage` key (`COLOR_SCHEME_LS_KEY = 'lit-devtools-color-scheme'`,
`:21`), read/applied entirely inside the **panel** (`devtools-settings.ts:174,
188-191`). It never touches the inspected page or `SettingsOverride` — it only
sets a class on the panel iframe's own `document.documentElement`
(`color-scheme.ts:39-43`). This is a strong signal for where the
`DevframeSettingsRegistry.lit.appearance` stub was meant to plug in: same
shape (`'auto' | 'dark' | 'light'`), same "my personal preference for how this
tool looks" semantics, currently stuck at the "per-browser" stage the roadmap
wants to move past.

## Decisions

**`project` vs `global`, concretely, for each candidate setting:**

| Setting                                                                            | Recommendation | Why                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appearance` (color scheme)                                                        | **`global`**   | Per-developer taste about _this tool's_ chrome. Putting it in `project` (→ the committable `workspace` storage dir, see above) would mean one developer's dark-mode preference shows up as a diff in every other teammate's checkout — clearly wrong once you know `project` means "committed." |
| `sourceOverlayEditor`                                                              | **`global`**   | Which editor _I_ personally run is a machine fact, not a project fact — two developers on the same repo routinely use different editors. `project` would force a team-wide default into version control for a per-person choice.                                                                |
| `hmrReconnect` / `hmrOnIncompatible` / `hmrIndicatorVisible` / `hmrIndicatorCount` | **`global`**   | Same reasoning: these are "how do I like my HMR feedback to behave," not project policy. The project-level default already exists — it's `litPlugin({hmr: {...}})` in `vite.config.ts`, which _is_ committed, on purpose, elsewhere.                                                            |

**None of today's `SettingsOverride` fields are good `project`-scope
candidates.** That scope is for genuinely shared, committable project
convention — closer to `.vscode/settings.json` than to a personal dotfile. If
a future setting is added that really is "the team agreed everyone opens
files in the same editor" or similar, `project` would be right for it; nothing
in the current Settings tab is that.

**`SETTINGS_OVERRIDE_LS_KEY` stays.** See "Current state" above — this isn't a
close call. What changes is what backs it: today `localStorage` is the only
copy of the value; after this plan, `settings.global` is the durable copy and
`localStorage` becomes a synchronous **cache** of it, refreshed whenever the
panel is open. A fresh browser with no prior `localStorage` still won't see a
global override until the panel has connected at least once in that browser —
that's a pre-existing limitation (today it wouldn't see a browser-specific
override either), not a new one.

**Layer toggles and the recording flag: stay ephemeral (shared state), do not
migrate.**

- **Recording**: definitely ephemeral. The prompt is right about this — a
  persisted "recording: true" surviving a dev-server restart would show the
  panel as recording while the buffer is empty (the restart also drops the
  in-memory event stream and every connected page), which is actively
  confusing rather than helpful. Recording is a "right now" action, not a
  preference. `session.layers.recordingState` (`protocol.ts:81-90`) is the
  right kind of state for it — shared, reconnect-safe, restart-clearing.
- **Layer toggles** (`litLifecycleEnabled`, `litRenderEnabled`,
  `mouseEventEnabled`, `keyboardEventEnabled`): a closer call, argued both
  ways —
  - _For migrating to `settings.global`_: a developer doing sustained
    interaction-heavy debugging might reasonably want "mouse events on" to
    survive several dev-server restarts in one work session, and unlike
    recording, an enabled-but-currently-empty layer isn't confusing — it's
    just quiet until the next event.
  - _Against, and this plan's recommendation_: these four booleans are one
    coherent unit with `recordingState` inside `TimelineLayersState`
    (`src/types/timeline.ts:30-36`, `DEFAULT_LAYERS_STATE:45-51`) and inside
    `SessionState` (`protocol.ts:81-90`). Splitting it — recording ephemeral,
    layers persisted — means two different persistence stories for one struct
    that is read and written as a whole today (`session.mutate` in
    `definition.ts:246-267`, `source.setLayers(state.layers)` in
    `definition.ts:166-168`). That split is real implementation cost (the
    `all()`/`onChange()` shapes don't compose cleanly with "some fields
    ephemeral, some durable" inside one shared-state object) for a benefit
    that's speculative — no user request or observed friction motivates it,
    unlike the appearance/editor settings, which visibly reset on every fresh
    browser today. Revisit only if a maintainer or user asks for it
    specifically; until then, leave `TimelineLayersState` exactly as it is.

## Steps

### Step 1: Wire `settings.global` for `appearance`

In `src/lib/devframe/definition.ts`'s `setup()` (after `const my = ctx.scope(LIT_DEVFRAME_ID);`,
`definition.ts:92`), read the persisted appearance once at boot and push it to
the panel's `get-meta` result, or — simpler, and consistent with "settings are
a client-scoped store, not a server-computed value" — leave `get-meta`
untouched and have the panel read `client.scope('lit').settings.global` (i.e.
`(await litRpc()).settings.global`, per `src/panel/client.ts:38-45`, which
already returns a `DevframeScopedClientContext` with a `.settings` field)
directly. Prefer the second: it needs no change to `definition.ts`'s RPC
surface at all, only to the panel.

In `src/panel/devtools-settings.ts`:

- `connectedCallback()` (`:171-176`): replace
  `this._colorScheme = readColorSchemePreference();` with an async load from
  `(await litRpc()).settings.global.get('appearance')`, falling back to
  `readColorSchemePreference()` (today's `localStorage` read) while the RPC is
  in flight or if it rejects — the panel already tolerates a `_loaded` gate
  (`:168, 193-202`) for exactly this kind of async bootstrap.
- `_setColorScheme()` (`:188-191`): keep calling
  `setColorSchemePreference(scheme)` (still applies the class to the panel
  document immediately, synchronously — don't regress that), and additionally
  `await (await litRpc()).settings.global.set('appearance', scheme)`.
- Keep `COLOR_SCHEME_LS_KEY` / `color-scheme.ts` exactly as-is. It remains the
  synchronous apply-on-load path for the panel's own first paint (same
  argument as `SETTINGS_OVERRIDE_LS_KEY` for the page — an RPC round trip
  cannot gate first paint without a flash), just no longer the only persisted
  copy.

### Step 2: Wire `settings.global` for the HMR/editor overrides, mirrored into `localStorage`

This is the part that actually changes the "per-browser" story for
`SettingsOverride`, without breaking the synchronous page-startup path.

In `src/lib/devframe/definition.ts`'s `set-settings-override` handler
(`:271-280`), in addition to `source.setSettingsOverride(override)`, persist
the merged result: `await my.settings.global.set(...)` for each field present
in `override` (or store the whole `SettingsOverride` object under one key,
e.g. `my.settings.global.set('override', override)` — simpler, and matches
how the panel already treats it as one JSON blob in `localStorage`; prefer
this over exploding it into five separate settings keys unless a reason
appears to need field-level `onChange`).

At panel connect (`devtools-settings.ts:171-176`), also read
`(await litRpc()).settings.global.get('override')` and reconcile: if it
differs from the current `localStorage` copy, treat the settings-store value
as authoritative, write it into `localStorage` (so the page's next reload
picks it up synchronously via the existing `readOverride()`), and re-push it
over `set-settings-override` so an already-loaded page in _this_ browser picks
it up live too. This is the "stops settings from being per-browser" behavior:
open the same project from a second browser, and its first panel connection
hydrates that browser's `localStorage` from the shared `global` settings
store.

Do not change `src/lib/runtime/overrides.ts` at all. Its job — synchronous
`localStorage` read at startup — is unaffected by where the _panel_ now
additionally persists the value.

### Step 3: Extend the boot test

`src/test/unit/devframe_test.ts`'s `boot()` helper
(`devframe_test.ts:63-79`) constructs a real `DevframeNodeContext` via
`initDevframe()`. Add a test that calls
`ctx.scope('lit').settings.global.set('override', {sourceOverlayEditor: 'zed'})`
and asserts `.get('override')` round-trips, to pin the augmentation's shape
independently of the panel UI.

### Step 4: Document

Update `docs/src/content/docs/reference/options.mdx` or the DevTools guide
with a short note: the Settings tab's overrides (and appearance) now persist
per-developer-machine via devframe's settings store, not just per-browser —
and, since this is a genuine behavior change worth flagging, mention that a
project's `.gitignore` does not need any new entry (the `global` scope lives
under the user's home directory, not the checkout).

## Verification

- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0, including the new `devframe_test.ts` case
- `pnpm run build` → exit 0
- Manual (best effort, note in your report if skipped): in the playground,
  set a color-scheme or editor preference in the panel, fully quit and restart
  `pnpm run dev`, reconnect the panel in the **same** browser with
  `localStorage` for that origin cleared (DevTools → Application → Clear
  site data, or a private window) — the preference should reappear once the
  panel connects, proving the `global` store (not just `localStorage`) is the
  source of truth.
- `git status --porcelain` shows changes confined to:
  `src/lib/devframe/definition.ts`, `src/panel/devtools-settings.ts`,
  `src/test/unit/devframe_test.ts`, docs. **No** changes to
  `src/lib/runtime/overrides.ts`, `src/types/timeline.ts`'s
  `SETTINGS_OVERRIDE_LS_KEY`/`SETTINGS_OVERRIDE_CHANNEL` constants, or
  `src/lib/color-scheme.ts`.

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above do not match the live code (drift).
- You find `DevframeSettings.project` actually persists to the `'project'`
  storage scope (private, `node_modules`-nested) rather than `'workspace'`
  (committable) in the installed `devframe@1.0.0` — that would flip several
  recommendations in "Decisions" above, and you should re-derive them against
  the corrected mapping rather than proceeding on this plan's (verified at
  write-time, but re-verify) reading.
- You're tempted to remove `SETTINGS_OVERRIDE_LS_KEY`, `COLOR_SCHEME_LS_KEY`,
  or make `src/lib/runtime/overrides.ts` async in any way. The synchronous,
  connection-independent startup read is the entire reason this plan keeps
  both keys; removing either is a regression this plan explicitly rejects.
- You find yourself splitting `TimelineLayersState` to persist layer toggles
  while keeping recording ephemeral — that's explicitly out of scope per
  "Decisions"; raise it as a separate, argued proposal instead.
- `client.scope('lit').settings` behaves differently than the typings above
  claim once exercised for real (e.g. `.get()` on an unset key throws instead
  of resolving `undefined`) — the `.d.mts` files were read directly but never
  executed as part of this research.
