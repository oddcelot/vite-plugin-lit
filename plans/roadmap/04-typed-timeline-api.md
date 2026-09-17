# Plan 04: Type the public timeline API

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**:
> `git diff --stat 2889243..HEAD -- client.d.ts package.json tsconfig.json src/lib/plugin.ts src/lib/runtime/timeline/public-api.ts src/types/timeline.ts docs/src/content/docs/reference/import-queries.mdx docs/src/content/docs/reference/runtime-api.mdx docs/src/content/docs/guides/devtools-timeline/custom-layers.mdx`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2 — a documented, supported extension point throws a
  compiler error for anyone who follows the docs; low urgency (there's a
  documented workaround) but real DX cost.
- **Effort**: S — one ambient declaration, one `tsconfig.json` line, a small
  fixture to prove the fix, and a docs cleanup pass.
- **Risk**: LOW. The change is additive (a new `declare module` block) and
  touches no runtime code.
- **Depends on**: none. Independent of Plan 02 (agent timeline access) —
  that plan's `lit:recent-events` RPC is a devframe/MCP-facing surface, not
  the `virtual:lit-plugin/timeline` module this plan types for app code.
- **Category**: dx / bug (documented feature, broken as documented)
- **Planned at**: commit `2889243`, 2026-09-17

## Why this matters — and where the original finding drifted

`advisor-plans/README.md:66-74` ("Direction" item 1, from the `improve`
audit at commit `08f53c5`) recorded this gap citing `README.md:147-168`.
**That citation is now stale**, not because the underlying problem was
fixed, but because the docs moved: commit history since `08f53c5` shows
`README.md` was trimmed from ~530 lines to a front door
(`git diff --stat 08f53c5..HEAD -- README.md` shows 480 lines removed) and
an Astro/Starlight docs site was added. The same content — and the same
unresolved gap — now lives in:

- `docs/src/content/docs/reference/runtime-api.mdx:81-116`
- `docs/src/content/docs/guides/devtools-timeline/custom-layers.mdx:14-45`
- `docs/src/content/docs/reference/import-queries.mdx:63-104`

The underlying problem the advisor found is real and still open: a
TypeScript consumer who imports `virtual:lit-plugin/timeline` exactly as
documented gets `TS2307: Cannot find module`. The docs site is honest about
this — it already contains a `<Aside type="caution" title="No ambient types
yet">` and a hand-rollable `declare module` workaround
(`import-queries.mdx:76-99`) that links back to
`advisor-plans/README.md` as the tracking issue. **This plan supersedes that
advisor-plans item**: it verifies the gap against the current docs location
and ships the fix, rather than the "an afternoon, trade-off noted" framing
the original finding used.

## Current state

### The runtime module and what it exports

`src/lib/runtime/timeline/public-api.ts:1-52` (full file):

```ts
/**
 * Public timeline API — re-exported by the `virtual:lit-plugin/timeline`
 * virtual module so app code and other plugins can contribute events and
 * custom layers without reaching into plugin internals.
 *
 * This module shares the same `transport.ts` instance as `install.ts`, so
 * events emitted here flow through the same batched HMR channel to the panel.
 */

import {emit, setHotClientCallback} from './transport.js';
import type {TimelineEvent, TimelineLayer} from '../../../types/timeline.js';

export type {TimelineEvent, TimelineLayer};

/**
 * Emit a custom timeline event from app code.
 *
 * The event is forwarded to the Timeline panel when recording is active.
 * Use a custom `layerId` registered with `addTimelineLayer`, or one of the
 * built-in layer ids (`'lit-lifecycle'`, `'lit-render'`, `'mouse'`,
 * `'keyboard'`).
 *
 * No-ops in production (the HMR channel is absent; events are dropped in the
 * transport queue).
 */
export const addTimelineEvent = (event: TimelineEvent): void => {
  emit(event);
};

type ViteHot = {send: (event: string, data: unknown) => void};

/**
 * Register a custom timeline layer and announce it to the panel.
 *
 * The panel adds the layer to its toggle strip after the built-in layers.
 * The registration message is sent once on first call; duplicate ids are
 * ignored.
 */
export const addTimelineLayer = (layer: TimelineLayer): void => {
  const send = (): void => {
    (import.meta as {hot?: ViteHot}).hot?.send('lit:timeline:custom-layer', {
      layer,
    });
  };
  setHotClientCallback(send);
};
```

The complete public surface is: two functions
(`addTimelineEvent`, `addTimelineLayer`) and two types
(`TimelineEvent`, `TimelineLayer`), the latter re-exported straight from
`src/types/timeline.ts:7-28`:

```ts
export interface TimelineLayer {
  id: string;
  label: string;
  color: number; // 0xRRGGBB
}

export interface TimelineEvent<TData = unknown> {
  layerId: string;
  /** `performance.now()` timestamp in the browser. */
  time: number;
  data: TData;
  title?: string;
  subtitle?: string;
  /** Pairs a start event with its matching end event in the same update group. */
  groupId?: number | string;
  logType?: 'default' | 'warning' | 'error';
  meta?: {
    elementId?: number;
    tagName?: string;
    source?: {file: string; line: number};
  };
}
```

Note `meta` is populated by the plugin's own built-in capture layers (see
`src/lib/runtime/timeline/lifecycle.ts`), not something app code needs to
set — but the type is not narrowed for the public surface, so an app-authored
event can technically set it too. Decision below: ship the real type as-is,
not a narrowed copy (see "Which types become public").

Also note: `time`'s doc comment ("`performance.now()` timestamp in the
browser") is stale relative to `src/lib/runtime/timeline/clock.ts:7-25`,
which rezeroes this clock on each recording start (it's "ms since recording
started," not raw `performance.now()`). Since this comment is about to be
copied into a shipped, public ambient declaration, fix the wording as part
of this plan rather than freezing the imprecise version (see Step 1).

### How the virtual module resolves — and a build-mode gap beyond this plan's scope

`src/lib/plugin.ts:727-729` (the plugin that owns virtual-module resolution):

```ts
  const hmr: Plugin = {
    name: 'lit-plugin',
    apply: 'serve',
```

`src/lib/plugin.ts:742-746`:

```ts
    resolveId(id) {
      // Public timeline API virtual module.
      if (id === 'virtual:lit-plugin/timeline') {
        return '\0virtual:lit-plugin/timeline';
      }
```

`src/lib/plugin.ts:770-787`:

```ts
    load(id) {
      // Public timeline API — re-export the runtime module when timeline is
      // enabled, otherwise a no-op stub so imports don't throw in prod builds.
      if (id === '\0virtual:lit-plugin/timeline') {
        if (!resolved.timeline) {
          return {
            code:
              'export const addTimelineEvent = () => {};\n' +
              'export const addTimelineLayer = () => {};\n',
            moduleType: 'js',
          };
        }
        const apiPath = resolveRuntimeModule('timeline/public-api');
        return {
          code: `export * from ${JSON.stringify(apiPath)};\n`,
          moduleType: 'js',
        };
      }
```

**This is worth flagging even though it's out of scope for a typing plan**:
`hmr` (the only plugin whose `resolveId`/`load` handle
`virtual:lit-plugin/timeline`) has `apply: 'serve'`. Vite skips every hook
on a plugin with `apply: 'serve'` during `vite build`. The comment at
`:771-772` ("otherwise a no-op stub so imports don't throw in prod builds")
and the docs' claim that the module "resolves to a no-op stub in production"
(`runtime-api.mdx:112-113`, `custom-layers.mdx:33-34`) both describe a
no-op-in-production behavior that this code path **cannot reach**, because
the whole plugin is dev-only — during `vite build` nothing resolves
`virtual:lit-plugin/timeline` at all, and Rollup should fail to resolve the
import outright. `import-queries.mdx:101-102` states "the runtime shape is
stable — this is a typing gap, not a behavioural one," which this reading
of the code contradicts for the production-build case specifically.

**This plan does not fix that** — it's a `vite build` resolution bug in
`src/lib/plugin.ts`, not a typing gap, and fixing it means changing which
plugin object owns the virtual module (or its `apply` condition), which is
a different, riskier change than adding an ambient declaration. Recommend a
separate, small follow-up plan scoped to `src/lib/plugin.ts:727-787` that:
(a) confirms with a build-mode fixture whether `vite build` really throws
today, and (b) if so, gives the timeline virtual module its own
always-applied `resolveId`/`load` pair (or moves it out of `apply: 'serve'`)
so the documented no-op-in-production behavior is real. Do not fold that fix
into this plan — it changes runtime behavior, this plan changes types only.

### `client.d.ts` — the file this plan edits

`client.d.ts:1-22` (full file):

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Ambient types for the import queries provided by the Lit Vite plugin.
 *
 * Reference via tsconfig (`"types": ["@oddsquad/vite-plugin-lit/client"]`) or
 * `/// <reference types="@oddsquad/vite-plugin-lit/client" />`.
 */

declare module '*.css?hmr-url' {
  const href: string;
  export default href;
}

declare module '*.css?css-sheet' {
  const sheet: CSSStyleSheet;
  export default sheet;
}
```

Only the two CSS import queries are declared. No `virtual:` module
declaration exists.

### `package.json` — `exports` has no entry that could type this module, and none should be added

`package.json:17-29`:

```json
  "exports": {
    ".": {
      "types": "./index.d.ts",
      "default": "./index.js"
    },
    "./css.js": {
      "types": "./lib/runtime/css.d.ts",
      "default": "./lib/runtime/css.js"
    },
    "./client": {
      "types": "./client.d.ts"
    }
  },
```

`virtual:lit-plugin/timeline` is resolved by Vite's `resolveId`/`load`
plugin hooks (above), never through Node/TypeScript package resolution — so
`exports` cannot type it and does not need an entry for it. `./css.js` is a
different case: `@oddsquad/vite-plugin-lit/css.js` is a real bare specifier
apps import (`src/lib/plugin.ts:756-758` resolves it to a real file on
disk), so it legitimately needs a real `exports` entry. The timeline API has
no equivalent real specifier — its only advertised import path is the
virtual module, typed the same way the CSS queries already are: via
`client.d.ts`'s ambient declarations, referenced through `tsconfig.json`'s
`types` array. **Conclusion: no `exports` change is needed or wanted.**

### `tsconfig.json` doesn't type-check `client.d.ts` today

`tsconfig.json:1-29` (full file):

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["es2022", "DOM", "DOM.Iterable"],
    "outDir": ".",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "inlineSources": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "noImplicitOverride": true,
    "allowSyntheticDefaultImports": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/test/**"]
}
```

`include` is `src/**/*.ts` only. `client.d.ts` lives at the repo root and is
never part of this program, so `pnpm run build` (`tsc --pretty`) and
`vp check` never type-check it — a syntax error in `client.d.ts` today would
ship silently. This plan adds `client.d.ts` to `include` so the new
declaration (and the two existing ones) are checked on every build, closing
that gap as a side effect.

### What the docs currently tell users to do instead

`docs/src/content/docs/reference/import-queries.mdx:63-99`:

```mdx
## virtual:lit-plugin/timeline

The [custom timeline layers](/vite-plugin-lit/guides/devtools-timeline/custom-layers/)
API is imported from a virtual module:

\`\`\`ts
import {addTimelineEvent, addTimelineLayer} from 'virtual:lit-plugin/timeline';
\`\`\`

This module currently has **no** ambient declaration, so TypeScript reports
`TS2307: Cannot find module 'virtual:lit-plugin/timeline'`. Until one ships,
declare it yourself in a `.d.ts` in your project:

\`\`\`ts
declare module 'virtual:lit-plugin/timeline' {
export interface TimelineLayer {
id: string;
label: string;
/\*_ 0xRRGGBB _/
color: number;
}

export interface TimelineEvent<TData = unknown> {
layerId: string;
/\*_ `performance.now()` timestamp. _/
time: number;
data: TData;
title?: string;
subtitle?: string;
groupId?: number | string;
logType?: 'default' | 'warning' | 'error';
}

export function addTimelineEvent(event: TimelineEvent): void;
export function addTimelineLayer(layer: TimelineLayer): void;
}
\`\`\`

The runtime shape is stable — this is a typing gap, not a behavioural one. It
is tracked as a known gap in the repository's
[advisor plans](https://github.com/oddcelot/vite-plugin-lit/blob/main/advisor-plans/README.md).
```

This workaround **omits `meta`** from `TimelineEvent` — a real discrepancy
from the runtime type (`src/types/timeline.ts:23-27`) worth resolving when
this ships (see "Which types become public" below), not perpetuating.

## Design

### Approach: a self-contained ambient declaration in `client.d.ts`, not a type import from the runtime module

Two ways to type the virtual module were considered:

**A. Inline, self-contained `declare module` block in `client.d.ts`** (chosen).
Matches the file's existing style — the two CSS query declarations are
already self-contained, no imports. `client.d.ts` is a hand-authored static
file (not compiled from `src/`, shipped via the `files` array), so this is
the natural fit.

**B. `import type` from a real subpath, e.g. a hypothetical
`@oddsquad/vite-plugin-lit/timeline.js` exports entry pointing at
`lib/runtime/timeline/public-api.d.ts`.** Rejected: it would require adding
a _real_ subpath export for a module that is deliberately not meant to be
imported directly — `public-api.ts` wires straight into `transport.ts`
(dev-only HMR machinery) with none of the "no-op when the `timeline` option
is disabled" safety the virtual module's `load()` hook provides
(`plugin.ts:773-781`). A real subpath import would bypass that safety and
give consumers a second, behaviorally different way to reach the same
functions. Not worth it just to avoid duplicating two small interfaces.

### Which types become public

Ship `TimelineLayer` and `TimelineEvent` exactly as they exist in
`src/types/timeline.ts:7-28` (including `meta`, unlike the docs' current
workaround), because:

- `public-api.ts:19` already re-exports the real type verbatim
  (`export type {TimelineEvent, TimelineLayer};`) — nothing today stops an
  app from setting `meta` on a custom event, so a narrowed public type would
  be typed _more restrictively_ than the actual runtime accepts, which is
  its own kind of lie.
- Keeping one canonical shape (rather than a hand-narrowed "public" version)
  means there's one place to update if the type ever changes, not two.

Fix the stale `time` doc comment while copying it in (see Step 1) — this is
the one place this plan should _not_ copy verbatim.

### The trade-off this plan accepts, explicitly

Shipping this ambient declaration **freezes `virtual:lit-plugin/timeline`'s
current shape as public API surface** — exactly the trade-off
`advisor-plans/README.md:73-74` flagged. Once published, adding a required
field to `TimelineEvent` or `TimelineLayer`, or changing `addTimelineEvent`'s
signature, becomes a breaking change for every consumer who referenced
`@oddsquad/vite-plugin-lit/client`. This plan accepts that trade-off on the
grounds that the shape has been stable since these types were introduced,
is already effectively public (documented, with a copy-paste workaround
users are already relying on), and the cost of _not_ shipping it — a
documented feature that fails exactly as described for any TypeScript user
who follows the docs — is a worse, ongoing DX cost than the future
constraint of stability.

### Guarding against the two copies drifting

`client.d.ts` is hand-authored and cannot `import` from `src/types/timeline.ts`
without becoming part of the `src/` build (it isn't, and shouldn't be, since
it ships as a separate static file). Instead of leaving the two shapes
(`src/types/timeline.ts` vs. `client.d.ts`) to drift silently, add a small
compile-time fixture (Step 4) that fails a build if they diverge in an
incompatible way. This is cheaper than it sounds — a type-only assertion
file that a real consumer's tsconfig would exercise.

## Scope

**In scope**:

- `client.d.ts`
- `tsconfig.json` (`include` only)
- A new fixture under `src/test/fixtures/` (or similar) proving the ambient
  declaration resolves for a downstream-shaped tsconfig
- `docs/src/content/docs/reference/import-queries.mdx`
- `docs/src/content/docs/reference/runtime-api.mdx`
- `docs/src/content/docs/guides/devtools-timeline/custom-layers.mdx`

**Out of scope** (do NOT touch):

- `package.json` `exports` — established above that no entry is needed.
- `src/lib/plugin.ts` — the `apply: 'serve'` / production-build resolution
  gap noted above is a separate, behavioral bug; do not fix it here.
- `src/lib/runtime/timeline/public-api.ts` and `src/types/timeline.ts` —
  other than the one doc-comment wording fix called out in Step 1, the
  runtime types are not changing shape in this plan.
- `advisor-plans/README.md` — this plan supersedes its "Direction" item 1,
  but that file is the advisor skill's own output; leave it for whoever
  maintains that index to cross reference, rather than editing it here.

## Commands you will need

| Purpose           | Command               | Expected on success |
| ----------------- | --------------------- | ------------------- |
| Install           | `pnpm install`        | exit 0              |
| Format/lint/types | `pnpm exec vp check`  | exit 0              |
| Unit tests        | `pnpm run test:unit`  | exit 0              |
| Build             | `pnpm run build`      | exit 0              |
| Docs build        | `pnpm run docs:build` | exit 0              |

## Git workflow

- Branch: `roadmap/04-typed-timeline-api`
- Commit message style: capitalized imperative summary, no conventional-commit
  prefix (e.g. `Ship ambient types for the timeline virtual module`).
- Do NOT push or open a PR without asking first.

## Steps

### Step 1: Add the ambient declaration to `client.d.ts`

Append to `client.d.ts`:

```ts
declare module 'virtual:lit-plugin/timeline' {
  export interface TimelineLayer {
    id: string;
    label: string;
    /** 0xRRGGBB */
    color: number;
  }

  export interface TimelineEvent<TData = unknown> {
    layerId: string;
    /** Milliseconds since the current recording started. */
    time: number;
    data: TData;
    title?: string;
    subtitle?: string;
    /** Pairs a start event with its matching end event in the same update group. */
    groupId?: number | string;
    logType?: 'default' | 'warning' | 'error';
    /** Set by the plugin's built-in capture layers; not needed for custom events. */
    meta?: {
      elementId?: number;
      tagName?: string;
      source?: {file: string; line: number};
    };
  }

  /**
   * Emit a custom timeline event from app code. No-ops in production or
   * when the `timeline` option is disabled.
   */
  export function addTimelineEvent(event: TimelineEvent): void;

  /**
   * Register a custom timeline layer and announce it to the panel.
   * Idempotent — duplicate ids are ignored.
   */
  export function addTimelineLayer(layer: TimelineLayer): void;
}
```

Note the `time` doc comment is corrected here ("Milliseconds since the
current recording started") rather than copied verbatim from
`src/types/timeline.ts:15` — see "Current state" above for why.

**Verify**: `grep -n "virtual:lit-plugin/timeline" client.d.ts` → one match.

### Step 2: Add `client.d.ts` to the type-checked program

In `tsconfig.json`, change:

```json
  "include": ["src/**/*.ts"],
```

to:

```json
  "include": ["src/**/*.ts", "client.d.ts"],
```

**Verify**: `pnpm exec vp check` → exit 0 (this now type-checks
`client.d.ts` as part of the same pass; a syntax error in Step 1 would fail
here).

### Step 3: Reconcile the custom-layers migration note

Confirm (do not just assume) that the shared-state migration mentioned in
`plans/devframe-foundation.md` doesn't change what this plan ships:

`src/lib/devframe/definition.ts:132-139` — `addLayer` now writes into
`SessionState.customLayers` (devframe shared state, reconnect-safe) instead
of the old SSE relay described in `plans/devframe-foundation.md`'s
"Today (bespoke)" column (`GET /__lit-devtools-events` `event: layer`).

This is a **transport-internal change on the node/panel side**. It does not
touch `addTimelineLayer()`'s signature, its "idempotent, duplicate ids
ignored" contract (still enforced — compare
`src/lib/runtime/timeline/public-api.ts:45-52`'s send-once guard with
`definition.ts:132-137`'s `!state.customLayers.some(...)` dedup), or
anything `client.d.ts` needs to describe. **No action needed for the ambient
declaration.** One incidental improvement worth a sentence in the docs: a
panel or MCP client that connects _after_ `addTimelineLayer()` already ran
now still sees the layer (shared state persists it), where the old SSE
relay would have missed it for any listener that wasn't already attached.
Mention this in Step 5's docs pass; do not treat it as a required code
change.

**Verify**: none — this step is a documentation/verification exercise, not
a code change. Note the conclusion in your final report.

### Step 4: Add a fixture proving `TS2307` is gone

`tsconfig.json`'s own `include`/`exclude` doesn't exercise `client.d.ts` the
way a real consumer does — a real consumer references it via `types` or a
triple-slash directive, not by sitting in the same `src/` tree. Add a small
fixture that reproduces that shape:

1. Create `src/test/fixtures/client-types/consumer.ts`:
   ```ts
   /// <reference types="../../../../client.d.ts" />
   import {
     addTimelineEvent,
     addTimelineLayer,
   } from 'virtual:lit-plugin/timeline';

   addTimelineLayer({id: 'demo', label: 'Demo', color: 0xff0000});
   addTimelineEvent({layerId: 'demo', time: 0, data: {ok: true}});
   ```
   Adjust the relative reference path to match the fixture's actual depth
   under the repo root.
2. Create `src/test/fixtures/client-types/tsconfig.json`, a minimal program
   that only includes `consumer.ts` (do not fold it into the root
   `tsconfig.json`'s `include`/`exclude`, which excludes `src/test/**`):
   ```json
   {
     "compilerOptions": {
       "target": "es2022",
       "module": "NodeNext",
       "moduleResolution": "NodeNext",
       "strict": true,
       "noEmit": true
     },
     "include": ["consumer.ts"]
   }
   ```
3. Verify manually first: `pnpm exec tsc -p src/test/fixtures/client-types/tsconfig.json`
   → exit 0, with **no** `TS2307`.
4. Wire this into `package.json`'s `test:unit` or a dedicated script so it
   runs on every check, rather than staying a manual-only fixture. If
   `vite-plus`'s `vp test` runner has no clean way to shell out to `tsc` on
   a fixture, add a small script (`scripts/check-client-types.mjs`) that
   runs the above `tsc -p` command and exits non-zero on failure, then call
   it from `vp check` or `prepublishOnly` — whichever this repo's
   conventions favor once you look at how `prepublishOnly` is composed
   today (`package.json:50`).

**Verify**:

- `pnpm exec tsc -p src/test/fixtures/client-types/tsconfig.json` → exit 0
- Temporarily rename `client.d.ts` and re-run the same command — confirm it
  now fails with `TS2307`, proving the fixture actually exercises the gap.
  Restore `client.d.ts` immediately after.

### Step 5: Update the docs

1. `docs/src/content/docs/reference/import-queries.mdx:63-104`: remove the
   `<Aside type="caution" title="No ambient types yet">` block and the
   hand-rolled `declare module` workaround (`:76-99`); replace with a short
   note that `@oddsquad/vite-plugin-lit/client` now covers this module too,
   the same way it covers the two CSS queries above it in the same file.
   Remove the link to `advisor-plans/README.md` (`:102-103`) since the gap
   it tracked is now closed.
2. `docs/src/content/docs/guides/devtools-timeline/custom-layers.mdx:40-45`:
   remove the matching `<Aside type="caution" title="No ambient types
yet">` block.
3. `docs/src/content/docs/reference/runtime-api.mdx:112-116`: remove "It has
   no ambient declaration yet — see [import queries]... for the `declare
module` workaround" and replace with a pointer to
   `@oddsquad/vite-plugin-lit/client`, consistent with how the CSS helpers
   section above it is presented.
4. Per Step 3, add one sentence to `custom-layers.mdx` noting that a layer
   registered before a panel/agent connects is still visible once it does
   (shared-state persistence), if you judge it worth the extra line —
   optional, not required for "done."

**Verify**: `pnpm run docs:build` → exit 0; `pnpm run format:check` → exit 0.

### Step 6: Build and gate

**Verify**:

- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0 (includes the fixture check if wired into
  Step 4's script)
- `pnpm run build` → exit 0
- `pnpm run docs:build` → exit 0

## Verification

- `grep -n "virtual:lit-plugin/timeline" client.d.ts` → one match
- `pnpm exec tsc -p src/test/fixtures/client-types/tsconfig.json` → exit 0
- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0
- `pnpm run build` → exit 0
- `pnpm run docs:build` → exit 0
- `git status --porcelain` lists only files in "Scope" (plus gitignored
  build output)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above do not match the live code (drift) — in particular,
  re-check whether `README.md` has regained timeline documentation (it may
  have been intentionally trimmed further, or partially restored) before
  assuming the docs-site locations above are still current.
- Adding `client.d.ts` to `tsconfig.json`'s `include` produces unrelated
  type errors (e.g. from the two existing CSS declarations never having
  been checked before) that you cannot resolve within this plan's scope —
  report them rather than silently loosening `strict` settings to make them
  go away.
- You find that `vite build` in a real downstream project does **not**
  actually fail to resolve `virtual:lit-plugin/timeline` in production as
  the "Current state" section predicts — that would mean the `apply:
'serve'` reading above is wrong, and the docs' "resolves to a no-op stub
  in production" claim would be accurate after all. If so, correct the
  "Current state" section's build-mode paragraph before reporting back
  rather than silently dropping it; do not fix `plugin.ts` either way.
- You cannot find a clean way to wire the Step 4 fixture into an existing
  script without duplicating significant tsconfig plumbing — report the
  blocker rather than inventing a parallel test runner.

## Maintenance notes

- This plan freezes `TimelineEvent`/`TimelineLayer` as public API surface
  (see "The trade-off this plan accepts, explicitly" above). Any future
  change to either interface in `src/types/timeline.ts` must be checked
  against `client.d.ts`'s copy — the Step 4 fixture will catch an
  incompatible change (a required field added, a signature narrowed) but
  not a widening one (an optional field added), since the latter is
  backward compatible; update `client.d.ts` in the same change either way
  to keep the two copies honest.
- The `vite build` / `apply: 'serve'` production-resolution gap identified
  above (`src/lib/plugin.ts:727-729`) is real and unfixed. It is not part of
  this plan's "done" criteria. Recommend the maintainer open a follow-up
  scoped exactly to that, since it is a behavioral bug that happens to sit
  one file away from a typing fix, and conflating the two would make this
  plan's diff harder to review.
