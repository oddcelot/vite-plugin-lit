# Plan 05: Open-in-editor via `@devframes/service-open` (panel-only, endpoint stays)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/roadmap/README.md` (`05 | Open-in-editor via @devframes/service-open`)
> and, if the scope narrowed further during implementation, update that row's
> rationale text too — it currently promises "drops a dependency and hardens a
> filesystem path," which this plan's own research (see "Why the roadmap's
> premise doesn't fully hold" below) shows is only half true.
>
> **Drift check (run first)**:
> `git diff --stat 2889243..HEAD -- src/lib/plugin.ts src/lib/http.ts src/panel/components-view.ts src/panel/timeline-event-list.ts src/lib/runtime/source-overlay/overlay-element.ts src/test/unit/open-in-editor_test.ts src/lib/devframe/definition.ts src/lib/devframe/vite.ts package.json`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3 (roadmap DX-impact: MED; this plan narrows the original
  scope — see below)
- **Effort**: S (panel-side wiring) — do **not** attempt the "drop
  `launch-editor`" version described in `plans/roadmap/README.md`'s one-liner;
  that part is M/L and, per this plan's findings, not currently achievable
  without a regression (see "Decisions" below)
- **Risk**: LOW for the scope this plan actually recommends (additive,
  feature-detected, falls back to today's behavior); MED-HIGH for the
  full-replacement version the roadmap originally sketched (would break
  `sourceOverlay` without `timeline`, and the editor-key picklists don't match
  — see below)
- **Depends on**: none
- **Category**: feature / dependency hygiene
- **Planned at**: commit `2889243`, 2026-09-17

## Why this matters

`plans/roadmap/README.md:20` and `:57` list this as "drops a dependency and
hardens a filesystem path" — the assumption being that `@devframes/service-open`
(already a `devDependency`, `package.json:75`) can fully replace
`/__lit-open-in-editor`, `src/lib/http.ts`'s trust check, and the `launch-editor`
runtime dependency (`package.json:57`).

Having read the real code, that premise only holds for **one** of the three
call sites. The other two need the endpoint to keep existing regardless of what
this plan does, which changes the shape of the work from "migrate and delete"
to "add an optional, better path for the panel, and leave the rest alone."

## Current state

### The one endpoint, three callers

`src/lib/plugin.ts:298` defines the path and `src/lib/plugin.ts:300-402`
implements the middleware:

```ts
const OPEN_IN_EDITOR_PATH = '/__lit-open-in-editor';

export const createOpenInEditorMiddleware = (
  allowedRoots: readonly string[]
) => {
  // ...resolves `file`/`line`/`column`, confines the path to `allowedRoots`
  // via isTrustedRequest() + resolvePath()/startsWith(root + sep), then:
  import('launch-editor')
    .then((mod) => {
      const launch = mod.default ?? mod;
      launch(fileRef, (_fileName, errorMessage) => {
        if (errorMessage !== null) finish(500, errorMessage);
      });
      finish(200, 'ok');
    })
    .catch(next);
};
```

It is mounted unconditionally whenever `sourceOverlay` is on, **independent of
`timeline`** — `src/lib/plugin.ts:666-676`:

```ts
configureServer(server) {
  if (!resolved.sourceOverlay) return;
  const fsAllow = server.config.server.fs?.allow ?? [];
  server.middlewares.use(
    OPEN_IN_EDITOR_PATH,
    createOpenInEditorMiddleware([root, ...fsAllow])
  );
},
```

This is inside `sourceOverlayPlugin`, a plugin registered unconditionally in
the `litPlugin()` array (`src/lib/plugin.ts:900`). By contrast, the devframe hub
— and therefore any `ctx.services` a devframe declares — is only installed when
`timeline` is on (`src/lib/plugin.ts:903-911`):

```ts
if (resolved.timeline) {
  plugins.push(
    createLitDevframePlugin({
      version: PACKAGE_VERSION,
      features: () => toFeatureSettings(resolved),
    })
  );
}
```

`docs/src/content/docs/guides/source-overlay.mdx:17-19` documents
`litPlugin({sourceOverlay: true})` — no `timeline` — as the primary way to
enable the overlay, and `docs/src/content/docs/reference/options.mdx:96-121`
never implies `sourceOverlay` needs `timeline`. So **"sourceOverlay works with
timeline: false" is not an edge case, it's the documented default shape of the
feature.**

Three callers of the endpoint today:

1. **`src/lib/runtime/source-overlay/overlay-element.ts:189-207`** — the
   in-page overlay's click-to-open. This runs inside the inspected app's page,
   which has **no devframe RPC client at all**: its only transport is
   `import.meta.hot` (`overlay-element.ts:90-101`), used for HMR events and the
   `subscribeOverride` bridge, not a `connectDevframe()` connection. Per
   `plans/devframe-foundation.md`'s "Page runtime ↔ node transport" section,
   giving the page a real devframe client is **phase 3** ("in-page channel"),
   not done. So this caller structurally cannot reach
   `rpc.services.get('@devframes/service-open')` today, with or without
   `timeline` — there is no RPC client in that JS realm to call it from.
2. **`src/panel/components-view.ts:393-412`** (`_openSource()`) — plain
   `fetch('/__lit-open-in-editor?...')` from the panel iframe, which _does_
   hold a `connectDevframe()` client (`src/panel/client.ts:38-45`) and _does_
   only exist when `timeline: true` (the panel is only mounted by
   `createLitDevframePlugin`).
3. **`src/panel/timeline-event-list.ts:401-415`** — a plain `<a href="/__lit-open-in-editor?...">` in a timeline event's detail table, same panel-only context as #2.

### The test

`src/test/unit/open-in-editor_test.ts` is a full behavioral suite for
`createOpenInEditorMiddleware` (multi-root confinement, traversal rejection,
sibling-prefix rejection, the `isTrustedRequest` origin check, launch-editor
success/failure timing, 404/400/403/405 status codes — 15 tests total). It
mocks `launch-editor` with `vi.mock('launch-editor', () => ({default: launchMock}))`
(`open-in-editor_test.ts:29`). **None of this changes** under this plan: the
middleware it tests is not being removed. If a future plan _does_ remove the
endpoint (see "Decisions" below for why that's not this plan), this whole file
would need deleting alongside it.

### The real `@devframes/service-open` API

`node_modules/.pnpm/@devframes+service-open@1.0.0_devframe@1.0.0/node_modules/@devframes/service-open/dist/index.d.mts`:

```ts
export interface OpenServiceOptions {
  editor?: KnownEditor; // KnownEditor = 'code' | 'code-insiders' | 'cursor' | 'zed' | 'idea' | ... (31 values, no 'vscode', no 'windsurf')
  roots?: string[]; // additional dirs beyond the host's workspaceRoot; merged across installers
}
export interface OpenInEditorInput {
  path: string; // absolute, or relative to the service's workspaceRoot
  line?: number;
  column?: number;
  editor?: KnownEditor; // per-call override
}
export interface OpenServiceApi {
  openInEditor: (input: OpenInEditorInput) => Promise<void>;
  openInFinder: (input: {path: string}) => Promise<void>;
}
declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'devframes:service:open:open-in-editor': (
      input: OpenInEditorInput
    ) => Promise<void>;
    'devframes:service:open:open-in-finder': (input: {
      path: string;
    }) => Promise<void>;
  }
  interface DevframeServicesRegistry {
    '@devframes/service-open': OpenServiceApi;
  }
  interface DevframeServicesScopeRegistry {
    '@devframes/service-open': 'devframes:service:open';
  }
}
export declare function createOpenService(
  options?: OpenServiceOptions
): DevframeServiceDefinition<OpenServiceApi, OpenServiceOptions>;
```

`KnownEditor`, from `devframe/utils/launch-editor` (re-exported type, read at
`node_modules/devframe/dist/utils/launch-editor.d.mts:7`):

```ts
export type KnownEditor =
  | 'atom'
  | 'subl'
  | 'sublime'
  | 'sublime_text'
  | 'wstorm'
  | 'charm'
  | 'zed'
  | 'notepad++'
  | 'vim'
  | 'mvim'
  | 'joe'
  | 'gvim'
  | 'emacs'
  | 'emacsclient'
  | 'rmate'
  | 'mate'
  | 'code'
  | 'code-insiders'
  | 'codium'
  | 'vscodium'
  | 'trae'
  | 'antigravity'
  | 'cursor'
  | 'appcode'
  | 'clion'
  | 'idea'
  | 'phpstorm'
  | 'pycharm'
  | 'rubymine'
  | 'webstorm'
  | 'goland'
  | 'rider';
```

Compare our own picklist, `docs/src/content/docs/reference/options.mdx:107`:
"Built-in keys: `vscode` (default), `cursor`, `zed`, `idea`, `windsurf`" and
`src/lib/runtime/source-overlay/editors.ts:11-33`
(`BUILTIN_EDITORS = {vscode, cursor, zed, idea, windsurf}`) and
`src/types/timeline.ts:101-110` (`SOURCE_OVERLAY_EDITORS`, the panel's
`<select>` options — same five keys).

**Two of our five keys don't survive contact with `KnownEditor`:** `'vscode'`
isn't a `KnownEditor` value (the closest is `'code'`), and `'windsurf'` isn't
in the list _at all_. That's not a naming quirk to paper over silently — it
means "the docs promise a Windsurf option, and the service can't honor it."

**The service's `editor`/`roots` options don't currently mean what our
`sourceOverlay.editor` option means, either.** Per
`docs/src/content/docs/guides/source-overlay.mdx:47-50`:

> Opening goes through a dev-server middleware, which is what makes it work
> without a URL scheme handler. When the dev server is unreachable ... the
> overlay falls back to the editor's URL scheme.

Read the middleware again (`src/lib/plugin.ts:363-402`): it never passes an
`editor` argument to `launch-editor` — it always auto-detects
(`launch-editor`'s own `LAUNCH_EDITOR` env / heuristic). So today,
**`sourceOverlay.editor` only controls the URL-scheme _fallback_** in
`overlay-element.ts:206` (`window.open(this.#editor.url(path, lineNumber))`);
it has never controlled which editor the server-side open uses. Wiring the
service in for the panel's opens would, for the first time, make an `editor`
choice actually reach the process the dev server launches — a **behavior
change**, not a straight swap, and one whose picklist doesn't match what the
option currently documents.

### Package placement

`@devframes/service-open` is currently a `devDependency`
(`package.json:75`), while `devframe` itself is a runtime `dependency`
(`package.json:55`). Per `DevframeDefinition.services`'s doc comment
(`node_modules/devframe/dist/context--tVkJw3W.d.mts:1520-1531`): a descriptor
entry means "the host imports the package's default-export factory, resolving
it against **this plugin's own dependencies**" — i.e. against
`@oddsquad/vite-plugin-lit`'s own installed packages, via `importMetaUrl`
(`definition.ts:86`, already set). A `devDependency` is not installed for
consumers of the published package, so **`@devframes/service-open` must move
to `dependencies` before any real app can resolve it** — this is not optional
polish, the feature silently no-ops (or throws, if `required: true`) for every
downstream consumer otherwise.

## Decisions

**Not a hard requirement — the endpoint is not going away.** The source
overlay (`overlay-element.ts`) has no devframe client and must keep working
with `timeline: false`, which is the documented default shape of the feature.
`launch-editor`, `src/lib/http.ts`, `OPEN_IN_EDITOR_PATH`, and
`open-in-editor_test.ts` all stay. This plan is scoped to **panel-originated**
opens only (`components-view.ts`, `timeline-event-list.ts`), which are the only
two call sites that (a) have a `DevframeScopedClientContext` in hand
(`src/panel/client.ts:38-45`) and (b) only exist when `timeline: true`, i.e.
exactly when the service can also exist.

**`launch-editor` and `src/lib/http.ts` cannot be dropped.** Both are load-bearing
for the overlay's standalone path. `open-in-editor_test.ts` stays as-is.

**User-visible behavior change, scoped narrowly:** when `timeline: true` _and_
`@devframes/service-open` is actually installed on the hub (i.e. the
consuming app also runs `@vitejs/devtools` with a working hub — verify this
holds at implementation time, see Step 1), the panel's "open in editor" affordances
gain real path containment against the service's `workspaceRoot` + `roots`
merge (on top of, not instead of, the endpoint's own containment when it falls
back) and, if wired, an explicit editor choice. Everywhere else — no
`timeline`, or `timeline: true` without a hub that actually installs the
service — behavior is pixel-identical to today, because the code
feature-detects and falls through to the existing `fetch()`.

**`sourceOverlay.editor` keeps its current, narrower meaning** (URL-scheme
fallback only) for this plan. Do **not** attempt to thread it into the
service's `editor` option: `'vscode'` → `'code'` and the missing `'windsurf'`
entry are real gaps, not translation details, and closing them is out of scope
here — flag it as a follow-up (see "STOP conditions").

## Steps

### Step 1: Move `@devframes/service-open` to `dependencies`

In `package.json`, move the `"@devframes/service-open": "1.0.0"` line from
`devDependencies` (line 75) to `dependencies`, next to `"devframe": "1.0.0"`
(line 55). Run `pnpm install` and confirm `pnpm exec vp check` still passes.

**Verify**: `grep -n "@devframes/service-open" package.json` shows it under
`dependencies`, not `devDependencies`.

### Step 2: Declare the service on the definition

In `src/lib/devframe/definition.ts`, add a `services` entry to the
`defineDevframe({...})` call (around `definition.ts:79-90`):

```ts
import {createOpenService} from '@devframes/service-open';
// ...
services: options.openInEditorRoots
  ? [createOpenService({roots: options.openInEditorRoots()})]
  : undefined,
```

Add `openInEditorRoots?: () => string[]` to `CreateLitDevframeOptions`
(`definition.ts:55-67`), mirroring the existing `features?: () => FeatureSettings | null`
pattern (a getter, not a snapshot, per the comment at `plugin.ts:903-905`).
Thread it from `src/lib/devframe/vite.ts`'s `createLitDevframePlugin` —
`vite.ts:171-214` — the same place `features` is threaded, sourcing the roots
from the same `[root, ...fsAllow]` the endpoint's own middleware uses
(`plugin.ts:668-676`). Note `vite.ts`'s `setup(ctx)` runs after
`configureServer`, so `server.config.server.fs?.allow` is available by then;
confirm this with a log or a unit test before assuming it.

Use the **descriptive** form (`createOpenService({...})` — already the "ready
`DevframeServiceDefinition`" per `DevframeServiceInput`'s doc,
`context--tVkJw3W.d.mts:1049-1054`) rather than a bare `{package: ...}`
descriptor, since we already have the roots value in hand and don't need the
host to re-resolve the factory.

**Verify**: `pnpm exec vp check` passes. Extend
`src/test/unit/devframe_test.ts`'s `boot()` helper to pass
`openInEditorRoots: () => ['/tmp/fake-root']` and assert
`ctx.services.get('@devframes/service-open')` is defined after `instance.ready`
resolves (mirrors the existing `ctx.rpc.list()` assertions at
`devframe_test.ts:87-100`).

### Step 3: Panel-side feature detection

In `src/panel/components-view.ts`, replace the body of `_openSource()`
(`components-view.ts:393-412`) with a version that tries the service first:

```ts
private async _openSource(): Promise<void> {
  const src = this._details?.source;
  if (src === undefined) return;
  try {
    const client = await litRpc();
    const service = client.base.services.get('@devframes/service-open');
    if (service !== undefined) {
      await service.rpc.call('open-in-editor', {path: src.file, line: src.line});
      return;
    }
  } catch (err) {
    console.warn('[lit-devtools] service-open failed, falling back', err);
  }
  // Fallback: today's endpoint, unchanged.
  const params = new URLSearchParams({file: src.file, line: String(src.line)});
  fetch(`/__lit-open-in-editor?${params.toString()}`)
    .then(async (res) => { /* ...unchanged... */ })
    .catch((err) => { /* ...unchanged... */ });
}
```

`client.base.services` is the unscoped client's surface
(`DevframeScopedClientContext` has no `services` field itself — confirmed at
`node_modules/devframe/dist/client/index.d.mts:179-192` — only `.base` does,
per `:432`). Import `litRpc` the same way the file already does (check its
current imports before assuming `getMeta`/`litRpc` are both already imported).

Apply the same pattern to the `href` in `src/panel/timeline-event-list.ts:401-415`
— that one is harder because it's a plain anchor `href`, not a click handler;
either convert it to a `@click` handler that calls the same helper (preferred,
consistent with `components-view.ts`) or accept that this one caller keeps
using the endpoint directly and say so explicitly in the PR description. Do
not silently leave it half-migrated without a comment explaining why.

**Verify**: `pnpm exec vp check`, `pnpm run test:unit`. Manually confirm in the
playground (`pnpm run dev`, DevTools → Lit → Components tab, select a component
with a source, click "open"): behavior should be unchanged with a normal Vite
DevTools setup, since `docs/src/content/docs/reference/options.mdx:126`
confirms `timeline` "Requires `@vitejs/devtools` and its `DevTools()` plugin to
be active in the same Vite config" — check the playground's own
`vite.config.ts` to see whether `@vitejs/devtools` is actually configured
there; if it isn't, the service will never install in this repo's own
playground and Step 3's primary path can only be exercised via the unit test
from Step 2, not manually. Say so in your report either way.

### Step 4: Document the change

Update `docs/src/content/docs/guides/source-overlay.mdx` and
`docs/src/content/docs/guides/devtools-timeline/index.mdx` with a short note:
panel-initiated opens use `@devframes/service-open` when the hub provides it,
with the existing endpoint as fallback; the in-page overlay itself is
unaffected. Do not claim the editor picklist is unified — it isn't (see
"Decisions").

## Verification

- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0 (including the new `devframe_test.ts` case and
  the unmodified `open-in-editor_test.ts`)
- `pnpm run build` → exit 0
- `git status --porcelain` shows changes only in: `package.json`,
  `src/lib/devframe/definition.ts`, `src/lib/devframe/vite.ts`,
  `src/panel/components-view.ts`, `src/test/unit/devframe_test.ts`, docs, and
  optionally `src/panel/timeline-event-list.ts`. **No** changes to
  `src/lib/plugin.ts`'s open-in-editor block, `src/lib/http.ts`,
  `src/test/unit/open-in-editor_test.ts`, or the `launch-editor` dependency
  entry.

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above do not match the live code (drift).
- You find yourself deleting or gating `createOpenInEditorMiddleware`,
  `OPEN_IN_EDITOR_PATH`, `src/lib/http.ts`, or the `launch-editor` dependency
  — that is explicitly out of scope; the overlay's standalone path needs them.
- You're tempted to map `sourceOverlay.editor: 'vscode'` → `'code'` and quietly
  drop `'windsurf'` support to make the service's `editor` option usable end to
  end. That is a real, user-visible capability regression (a documented editor
  option stops working) and needs its own plan with the maintainer's sign-off,
  not a silent shim inside this one.
- The playground has no `@vitejs/devtools` configured and you cannot otherwise
  verify the service actually installs on a real hub before merging — report
  this rather than merging unverified service-detection code.
- `ctx.services` (or `client.base.services`) doesn't behave as the typings
  above claim once exercised against the real `initDevframe()` test harness —
  the `.d.mts` files were read directly but never executed as part of this
  research.
