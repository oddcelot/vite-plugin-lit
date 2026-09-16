# Plan 006: Characterization unit tests for the HMR patcher

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 08f53c5..HEAD -- src/lib/runtime/patch.ts src/test/unit/patch_test.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (test-only; no production code changes)
- **Depends on**: none. Recommended prerequisite for any future refactor of
  `src/lib/runtime/patch.ts` or the split of `src/lib/plugin.ts`.
- **Category**: tests
- **Planned at**: commit `08f53c5`, 2026-09-17

## Why this matters

`src/lib/runtime/patch.ts` (500 lines) is the reason this package exists: it
intercepts `customElements.define`, and when a module is re-executed by HMR it
patches the originally-registered class in place — re-parenting prototypes,
copying own members, snapshotting reactive property values through the old
accessors and restoring them through the new ones, re-adopting stylesheets, and
re-rendering live instances.

Its only unit coverage is seven tests for one small helper, `syncOwnMembers`
(`src/test/unit/patch_test.ts`). Everything else — `install`, the define
interceptor, `hotPatch`, the generation bookkeeping, the incompatible-class
bail-out — is covered only transitively by ~10 end-to-end tests that each boot a
Vite dev server and a real browser. That means a regression in a single branch
shows up as an opaque browser-test failure minutes into the suite, and the edge
cases with no playground fixture are not covered at all.

These are **characterization** tests: their job is to pin down what the code
does today so a future refactor has a fast, precise safety net. They are not
specification tests, and they are not a redesign.

## Current state

File under test: `src/lib/runtime/patch.ts`. Exported surface:

```ts
export interface PatchOptions { reconnect?: boolean; onIncompatible?: 'reload' | 'warn'; }
export const syncOwnMembers = (target: object, source: object, skip: ReadonlyArray<PropertyKey>): void => …
export const install = (options: PatchOptions = {}): void => …
```

Everything else (`instrument`, `usesStandardDecorators`, `stylesToSheets`,
`readoptStyles`, `incompatible`, `hotPatch`) is module-private and must be
exercised **through `install()`** — do not export them to make testing easier
(that is an out-of-scope production change).

`install()` at `src/lib/runtime/patch.ts:427-445`:

```ts
export const install = (options: PatchOptions = {}): void => {
  if (typeof customElements === 'undefined') {
    return;
  }
  const g = globalThis as unknown as Record<symbol, PatchState | undefined>;
  const existing = g[STATE_KEY];
  if (existing !== undefined) {
    // Already installed; refresh explicitly-provided options only.
    if (options.reconnect !== undefined) {
      existing.options.reconnect = options.reconnect;
    }
    if (options.onIncompatible !== undefined) {
      existing.options.onIncompatible = options.onIncompatible;
    }
    return;
  }
  …
```

Facts that shape the tests:

- The state singleton is pinned on `globalThis` under
  `Symbol.for('@lit-labs/vite-plugin-lit#patch')`
  (`src/lib/runtime/patch.ts:80`). **Tests must delete that key between cases**,
  or `install()` short-circuits on the second call.
- `install()` returns immediately when `typeof customElements === 'undefined'`.
  The unit project runs in the **node** environment
  (`vite.config.ts:14-20`: `environment: 'node'`), so the test must install a
  fake `customElements` on `globalThis` first.
- The define interceptor (`src/lib/runtime/patch.ts:463-500`) calls
  `this.get(name)` and the captured native `define`. A fake registry needs both
  `define` and `get`.
- `instrument` (`src/lib/runtime/patch.ts:137-183`) installs branded wrappers
  for `connectedCallback` / `disconnectedCallback` on the prototype. A test can
  register an "instance" by calling
  `Ctor.prototype.connectedCallback.call(fakeEl)`.
- `hotPatch` (`src/lib/runtime/patch.ts:290-…`) calls `NewClass.finalize()` when
  present, reads `elementProperties` (a `Map`) from both classes, snapshots each
  live instance's values, re-parents prototypes, calls `syncOwnMembers`,
  re-instruments, bumps `record.generation`, and defines `Symbol.hasInstance` on
  the new class.
- `incompatible` (`src/lib/runtime/patch.ts:268-283`) calls `location.reload()`
  unless `onIncompatible: 'warn'`. **Always pass `onIncompatible: 'warn'` in
  tests** so no test needs a `location` stub.
- `readoptStyles` returns early when `typeof ShadowRoot === 'undefined'`, which
  is the case in the node environment. Style re-adoption is therefore **not
  testable here** and is explicitly out of scope.
- `install()` calls `subscribeOverride((import.meta as {hot?: …}).hot, …)` from
  `../overrides.js`. In the node test environment `import.meta.hot` is
  undefined. Confirm in Step 1 that this is a no-op rather than a throw.

Existing test conventions — `src/test/unit/patch_test.ts` is the model:

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, test} from 'vite-plus/test';
import {syncOwnMembers} from '../../lib/runtime/patch.js';

describe('syncOwnMembers', () => {
  test('copies new members', () => {
    …
  });
});
```

Note: imports come from `vite-plus/test`, **not** `vitest`. Import paths use the
`.js` extension. `vi`, `beforeEach`, and `afterEach` are available from the same
module (see `src/test/unit/open-in-editor_test.ts:10`).

## Commands you will need

| Purpose           | Command                                      | Expected on success |
| ----------------- | -------------------------------------------- | ------------------- |
| Install           | `pnpm install`                               | exit 0              |
| Format/lint/types | `pnpm exec vp check`                         | exit 0              |
| This test file    | `pnpm exec vp test run --project unit patch` | exit 0, all pass    |
| Unit tests        | `pnpm run test:unit`                         | exit 0              |
| Build             | `pnpm run build`                             | exit 0              |

## Scope

**In scope**:

- `src/test/unit/patch_test.ts` (extend; keep the existing `syncOwnMembers`
  block untouched)

**Out of scope** (do NOT touch):

- `src/lib/runtime/patch.ts` — **no production changes at all**. Not to add
  exports, not to add seams, not to "make it testable". If a behavior cannot be
  reached from `install()` with fakes, leave it untested and say so in your
  report.
- Any other test file, `vite.config.ts` (do not change the unit project's
  `environment`), and every other source file.
- Style re-adoption / `CSSStyleSheet` / `ShadowRoot` behavior — unreachable in
  the node environment.

## Git workflow

- Branch: `advisor/006-patch-characterization-tests`
- Commit per group of tests is fine. Message style: capitalized imperative
  summary, no conventional-commit prefix.
- Do NOT push or open a PR.

## Steps

### Step 1: Build the fake environment and prove `install()` runs

At the top of `src/test/unit/patch_test.ts` (below the existing imports), add a
test harness:

- A `FakeRegistry` class with `define(name, ctor)` (records into a `Map`) and
  `get(name)` (reads that map).
- `installFresh(options)`: deletes
  `(globalThis as any)[Symbol.for('@lit-labs/vite-plugin-lit#patch')]`, assigns
  a new `FakeRegistry` to `globalThis.customElements`, then calls
  `install({onIncompatible: 'warn', ...options})`.
- A minimal element base: plain classes are enough. Nothing needs to extend
  `HTMLElement` (which does not exist in node) — the patcher only touches
  prototypes and property descriptors. Use a base class with a
  `requestUpdate()` spy method where a test needs one.
- `beforeEach` calls `installFresh()`; `afterEach` restores/deletes
  `globalThis.customElements` and the state symbol.

Then write one smoke test: after `installFresh()`, defining a class calls
through to the fake registry (`registry.get('x-a')` returns the class) and the
prototype has an own `connectedCallback` afterwards (proof that `instrument`
ran).

**Verify**: `pnpm exec vp test run --project unit patch` → the new smoke test
passes and all seven existing `syncOwnMembers` tests still pass.

If `install()` throws because of `subscribeOverride`, STOP and report the stack
trace — do not stub out the import.

### Step 2: Characterize the define interceptor

Add a `describe('install / define interceptor', …)` block with these cases:

1. **First define registers with the platform** — the fake registry received
   the class.
2. **Re-defining the same class object is a no-op** — defining the identical
   constructor twice does not call the registry's `define` a second time and
   does not throw.
3. **Second, different class is not passed to the platform** — defining a new
   class under the same tag leaves `registry.get(tag)` returning the **first**
   (canonical) class object.
4. **`install()` is idempotent** — calling `install({reconnect: true})` after an
   initial `install()` does not re-wrap `customElements.define` (capture the
   function reference before and after and assert it is the same) and does
   update the option (observable via case 3 of Step 4, or skip asserting the
   option if it is not observable — do not add an export to observe it).

**Verify**: `pnpm exec vp test run --project unit patch` → all pass.

### Step 3: Characterize instance tracking and generations

Add a `describe('instance tracking', …)` block:

1. **connectedCallback registers the instance and calls through** — create a
   class whose prototype has its own `connectedCallback` spy, define it, then
   call `Ctor.prototype.connectedCallback.call(fakeInstance)`; assert the
   original spy ran.
2. **disconnectedCallback calls through** — same shape for the detach wrapper.
3. **A re-attached instance that missed a patch calls `requestUpdate()`** —
   connect an instance, hot-patch the tag with a new class, then call
   `connectedCallback` again on that instance and assert its `requestUpdate`
   spy was called. (This characterizes the generation-stamp catch-up at
   `src/lib/runtime/patch.ts:157-164`.)

**Verify**: `pnpm exec vp test run --project unit patch` → all pass.

### Step 4: Characterize `hotPatch` behavior

Add a `describe('hotPatch', …)` block. Each case defines a class under a tag,
connects one fake instance, then defines a **second** class under the same tag
and asserts on the canonical class:

1. **Prototype methods are updated in place** — the canonical class's prototype
   now runs the new implementation, and the canonical **class object identity is
   unchanged** (`registry.get(tag)` is still the first constructor).
2. **Vanished prototype members are removed** — a method present only on the old
   class is gone after the patch.
3. **Statics are synced** — a new static field appears on the canonical class;
   `prototype`, `name`, and `length` are not clobbered.
4. **`finalize()` is called on the new class when present** — spy on it.
5. **Reactive property values survive** — give both classes an
   `elementProperties` `Map` (e.g. `new Map([['count', {}]])`) and an accessor
   pair backed by a differently-named private field on each class; set
   `instance.count = 5` before the patch and assert it reads back as `5`
   afterwards. This is the single most valuable case in this plan — it is the
   behavior the whole package exists to provide.
6. **Standard-decorator classes bail out** — construct a new class carrying
   `Symbol.metadata` metadata in the shape `usesStandardDecorators`
   (`src/lib/runtime/patch.ts:189-218`) looks for; read that function first and
   build the fixture to match it exactly. Assert that `console.warn` was called
   (use `vi.spyOn(console, 'warn')`) and that the canonical prototype was **not**
   patched. Pass `onIncompatible: 'warn'` so no reload is attempted.
   If you cannot construct metadata that the detector accepts after two
   attempts, skip this case and report it — do not modify the detector.
7. **`instanceof` against the new class still matches old instances** — assert
   `fakeInstance instanceof NewClass` is `true` (characterizes the
   `Symbol.hasInstance` definition).

**Verify**: `pnpm exec vp test run --project unit patch` → all pass.

### Step 5: Full gate

**Verify**:

- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0
- `pnpm run build` → exit 0
- `git diff --stat src/lib/` → **empty** (no production file changed)

## Test plan

All new tests live in `src/test/unit/patch_test.ts`, appended after the existing
`describe('syncOwnMembers', …)` block, which must remain byte-identical.

Structure to produce:

- `describe('install / define interceptor')` — 4 cases (Step 2)
- `describe('instance tracking')` — 3 cases (Step 3)
- `describe('hotPatch')` — up to 7 cases (Step 4)

Model the file style on the existing block: `test('…', () => {…})`, direct
`expect` assertions, narrow casts instead of `any`.

Target: at least 12 new passing tests. If a case proves unreachable without
changing production code, omit it and list it in your report under "not
covered, and why" — that list is a deliverable of this plan, not a failure.

## Done criteria

ALL must hold:

- [ ] `pnpm exec vp check` exits 0
- [ ] `pnpm run test:unit` exits 0 with at least 12 more passing tests than
      before
- [ ] `pnpm run build` exits 0
- [ ] `git diff --stat src/lib/` is empty (no production code changed)
- [ ] `git diff src/test/unit/patch_test.ts` shows the original
      `describe('syncOwnMembers', …)` block unmodified
- [ ] `grep -c "from 'vitest'" src/test/unit/patch_test.ts` → 0 (imports come
      from `vite-plus/test`)
- [ ] Your report lists every case from Step 4 that you could not cover, with
      the reason
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `install()` throws in the node test environment (e.g. from
  `subscribeOverride`). Report the stack trace; do not stub the import or
  change `patch.ts`.
- You need to export a private function, add a parameter, or otherwise modify
  `src/lib/runtime/patch.ts` to make a test possible.
- A characterization test you write **fails** against current behavior. That
  means either the test encodes an assumption the code does not hold, or you
  found a real bug. Do not "fix" `patch.ts`; report the case and the actual
  behavior, and leave the test out or mark it clearly.
- The existing `syncOwnMembers` tests start failing.

## Maintenance notes

- These tests pin current behavior, including behavior that may be undesirable.
  When a future change intentionally alters one of them, the right move is to
  update the test **in the same commit** as the behavior change, with a note on
  why.
- Coverage deliberately excluded here, and still open: style re-adoption
  (`readoptStyles` / `stylesToSheets`, unreachable without a DOM environment),
  the `reconnect` option's disconnect/connect cycling, and the whole DevTools
  panel / inspector runtime. If unit coverage for the DOM-dependent paths is
  wanted later, that needs a browser-capable test project in `vite.config.ts` —
  a separate decision, not an extension of this plan.
- A reviewer should check that no file under `src/lib/` appears in the diff.
