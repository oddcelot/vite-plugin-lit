# Plan 004: Keep the DevTools element watch working across a hot patch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 08f53c5..HEAD -- src/lib/runtime/inspector/install.ts src/lib/runtime/patch.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (DevTools-only code path; off unless the panel is watching an
  element)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `08f53c5`, 2026-09-17

## Why this matters

The DevTools Components tab can "watch" an element so its details refresh as it
updates. The watch works by installing a wrapper as an **own property** on the
instance that calls the previously-captured `updated` implementation and then
pushes fresh details to the panel.

The captured implementation is the _function object_ that lived on the
prototype at watch time. The plugin's HMR then hot-patches components by copying
the new class's members onto the **existing prototype object**
(`syncOwnMembers(OldClass.prototype, NewClass.prototype, …)` in
`src/lib/runtime/patch.ts:348-349`). After that copy, the prototype carries the
new `updated`, but the instance's own wrapper still closes over the **old**
function — and because an own property shadows the prototype, the watched
element keeps executing the pre-edit `updated()` for as long as the watch is
active.

So the one element a developer is actively inspecting is the one element that
silently stops picking up edits. That is the exact inverse of the feature's
purpose, and it diverges the watched instance's real behavior from every other
instance of the same component. `patch.ts` already handles this class of bug for
its own lifecycle wrappers — `instrument()` is documented as "Called at first
define and again after every patch" — but the inspector's watch has no
equivalent re-arming.

The fix is to stop caching the prototype implementation and look it up through
the prototype chain on each call.

## Current state

File: `src/lib/runtime/inspector/install.ts` — browser-injected inspector
runtime, loaded when the DevTools panel is enabled.

`src/lib/runtime/inspector/install.ts:40-55` (context and types):

```ts
// -------------------------------------------------------------------------
// Live-watch: re-push details whenever the watched element finishes updating.
// We wrap the instance's `updated` (not the prototype) so the hook is scoped
// to one element and trivially removable, and it works without the timeline's
// recording gate.
// -------------------------------------------------------------------------

type Updatable = Element & {
  updated?: (changed: unknown) => void;
};
// Hold the watched element via a WeakRef so an active watch doesn't keep a
// removed element alive: the override and `restore` only reach `el` through
// the ref, leaving the DOM as its sole strong root.
let watched: {ref: WeakRef<Updatable>; restore: () => void} | null = null;
```

`src/lib/runtime/inspector/install.ts:55-88` (the code to change):

```ts
const unwatch = (): void => {
  watched?.restore();
  watched = null;
};

const watch = (id: number): void => {
  unwatch();
  const el = elementById(id) as Updatable | undefined;
  if (el === undefined) {
    send({type: 'gone', id});
    return;
  }
  const hadOwn = Object.prototype.hasOwnProperty.call(el, 'updated');
  const prev = el.updated;
  const ref = new WeakRef(el);
  el.updated = function (changed: unknown) {
    prev?.call(this, changed);
    const cur = ref.deref();
    if (cur !== undefined) {
      send({type: 'details', details: collectDetails(cur)});
    }
  };
  watched = {
    ref,
    restore: () => {
      const cur = ref.deref();
      if (cur === undefined) return;
      if (hadOwn) cur.updated = prev;
      else delete cur.updated;
    },
  };
  // Push an immediate snapshot so the panel doesn't wait for the next update.
  send({type: 'details', details: collectDetails(el)});
};
```

The other half of the story, `src/lib/runtime/patch.ts:344-352` (do not edit
this file — it is shown so you can see why the cached `prev` goes stale):

```ts
// 5. Sync own members new → old on the prototype and on statics.
syncOwnMembers(OldClass.prototype, NewClass.prototype, PROTO_SKIP);
syncOwnMembers(OldClass, NewClass, STATIC_SKIP);

// 6. The sync replaced/removed our lifecycle wrappers; re-instrument.
instrument(state, OldClass.prototype, record);
```

Key facts for the fix:

- The wrapper is an **own** property on the instance. Therefore
  `Object.getPrototypeOf(this).updated` inside the wrapper resolves to the
  class's current implementation, **not** to the wrapper — there is no infinite
  recursion risk.
- `hadOwn === true` means the instance already had its own `updated` before the
  watch. That function is not touched by a hot patch, so in that case the
  captured `prev` stays correct and must keep being used (and restored).
- `restore()` must keep behaving exactly as today: reinstate the captured own
  function when `hadOwn`, otherwise `delete` the own property so the prototype
  implementation shows through again.

Repo conventions:

- Arrow-function consts for helpers; `function` expressions only where `this`
  must bind dynamically (as in the wrapper above — keep it a `function`).
- No `any`, no `@ts-ignore`: the audited source tree contains none. Use a
  narrow cast (`as Updatable`) if you need one, matching the existing style.
- This module is browser-injected and must stay dependency-free.

## Commands you will need

| Purpose           | Command                                        | Expected on success |
| ----------------- | ---------------------------------------------- | ------------------- |
| Install           | `pnpm install`                                 | exit 0              |
| Format/lint/types | `pnpm exec vp check`                           | exit 0              |
| Unit tests        | `pnpm run test:unit`                           | exit 0              |
| Build             | `pnpm run build`                               | exit 0              |
| Timeline e2e      | `pnpm exec vp test run --project e2e timeline` | exit 0 (slow)       |

## Scope

**In scope**:

- `src/lib/runtime/inspector/install.ts`

**Out of scope** (do NOT touch):

- `src/lib/runtime/patch.ts` — do not add a callback, event, or hook for the
  inspector to subscribe to. The lazy-lookup fix needs no cooperation from the
  patcher, and `patch.ts` is the most safety-critical file in the package.
- `src/lib/runtime/inspector/collect.ts` and `serialize.ts`.
- `src/panel/**` — the panel side needs no change.
- Repo-root `lib/`, `types/`, `panel/`, `index.js` — generated build output.

## Git workflow

- Branch: `advisor/004-watch-stale-lifecycle`
- Commit message style: capitalized imperative summary, no conventional-commit
  prefix (e.g. `Resolve the watched element's updated() lazily`).
- Do NOT push or open a PR.

## Steps

### Step 1: Resolve the wrapped implementation lazily

In `src/lib/runtime/inspector/install.ts`, change `watch()` so the wrapper does
not close over a prototype function.

Target shape:

```ts
const watch = (id: number): void => {
  unwatch();
  const el = elementById(id) as Updatable | undefined;
  if (el === undefined) {
    send({type: 'gone', id});
    return;
  }
  const hadOwn = Object.prototype.hasOwnProperty.call(el, 'updated');
  // Only an *own* `updated` is stable across an HMR hot patch. A prototype
  // implementation is replaced in place on every patch
  // (`syncOwnMembers` in ../patch.ts), so caching it here would pin the
  // watched instance to the pre-edit code for the life of the watch —
  // resolve it through the prototype chain on each call instead.
  const ownPrev = hadOwn ? el.updated : undefined;
  const ref = new WeakRef(el);
  el.updated = function (changed: unknown) {
    const current =
      ownPrev ?? (Object.getPrototypeOf(this) as Updatable | null)?.updated;
    current?.call(this, changed);
    const cur = ref.deref();
    if (cur !== undefined) {
      send({type: 'details', details: collectDetails(cur)});
    }
  };
  watched = {
    ref,
    restore: () => {
      const cur = ref.deref();
      if (cur === undefined) return;
      if (hadOwn) cur.updated = ownPrev;
      else delete cur.updated;
    },
  };
  // Push an immediate snapshot so the panel doesn't wait for the next update.
  send({type: 'details', details: collectDetails(el)});
};
```

Adjust the `this` typing as the compiler requires (the file is under
`strict: true` with `noImplicitThis`); a `function (this: Updatable, changed:
unknown)` signature is acceptable if needed.

**Verify**:

- `pnpm exec vp check` → exit 0 (this typechecks the whole `src/`).
- `grep -n "const prev = el.updated" src/lib/runtime/inspector/install.ts` → no
  matches.

### Step 2: Confirm nothing else captured the same way

Search the inspector runtime for other one-time captures of a prototype
lifecycle method:

`grep -n "= el\.\|getPrototypeOf" src/lib/runtime/inspector/install.ts`

If you find another site that caches a prototype method into a closure for
later invocation, **do not fix it** — report it in your final message as a
follow-up. This plan covers `watch()` only.

**Verify**: the grep output is included in your report.

### Step 3: Build and gate

**Verify**:

- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0
- `pnpm run build` → exit 0
- `pnpm exec vp test run --project e2e timeline` → exit 0

### Step 4: Manual confirmation (best effort, optional but preferred)

There is no automated test for the watch path today (the inspector runtime has
no unit tests — that gap is tracked separately). If you can run a browser:

1. `pnpm run dev` (builds, then serves the playground on
   http://localhost:5179 with `timeline: true` and `sourceOverlay: true`).
2. Open Vite DevTools, Components tab, select a component, enable the watch.
3. Edit that component's `updated()` in `playground/src/*.ts` to log or render
   something new, save, and confirm the new behavior takes effect on the watched
   element.
4. **Revert any playground edit you made** — `git checkout -- playground/src`
   before finishing.

If you cannot run a browser, say so explicitly in your report rather than
claiming the behavior was verified.

**Verify**: `git status --porcelain` shows no modification under
`playground/`.

## Test plan

No automated test is added by this plan: the inspector runtime has no unit-test
harness today, and building one is a larger piece of work tracked as a separate
test-coverage finding. The verification for this change is:

- Typecheck + full unit suite + build stay green.
- The timeline e2e file, which exercises the panel plumbing, stays green.
- The optional manual check in Step 4.

Do **not** invent a new test harness for `install.ts` inside this plan; that is
out of scope and would balloon a one-function fix.

## Done criteria

ALL must hold:

- [ ] `pnpm exec vp check` exits 0
- [ ] `pnpm run test:unit` exits 0
- [ ] `pnpm run build` exits 0
- [ ] `pnpm exec vp test run --project e2e timeline` exits 0
- [ ] `grep -n "const prev = el.updated" src/lib/runtime/inspector/install.ts`
      returns no matches
- [ ] `grep -n "getPrototypeOf" src/lib/runtime/inspector/install.ts` shows the
      lookup inside the wrapper
- [ ] `git status --porcelain` lists only
      `src/lib/runtime/inspector/install.ts` (plus gitignored build output)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above do not match the live code (drift).
- The typechecker reports an error about `this` in the wrapper that you cannot
  resolve with a `this:` parameter annotation or a narrow cast after two
  attempts. Do not reach for `any` or `@ts-ignore` — the source tree currently
  contains neither.
- The timeline e2e test fails after your change but passed before it.
- You conclude the fix needs a hook or callback from `src/lib/runtime/patch.ts`.

## Maintenance notes

- The rule this encodes: anything that wraps a **prototype** method of a Lit
  component in dev must either re-arm after each hot patch (the `instrument()`
  pattern in `patch.ts`) or resolve the underlying implementation lazily (this
  plan). A reviewer should apply that rule to any new instrumentation.
- A related, unfixed instance of "registered once, never re-armed" lives in
  `src/lib/runtime/source-overlay/overlay-element.ts:99-103`, where four
  `hot.on(...)` listeners are re-registered on every `connectedCallback` without
  the `#overrideSubscribed`-style guard used a few lines below. It is a
  different failure mode (duplicate listeners on reconnect) and is deliberately
  **not** part of this plan.
