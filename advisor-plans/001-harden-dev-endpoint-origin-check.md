# Plan 001: Reject cross-site requests to the plugin's dev-server endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 08f53c5..HEAD -- src/lib/plugin.ts src/lib/timeline-plugin.ts src/test/unit/open-in-editor_test.ts`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `08f53c5`, 2026-09-17

## Why this matters

`@oddsquad/vite-plugin-lit` registers a dev-server endpoint,
`/__lit-open-in-editor`, that spawns the developer's editor on a file path
taken from the request. It is guarded by an `isSameOrigin()` check whose stated
purpose (see the comment at `src/lib/plugin.ts:297-299`) is to stop "a page the
developer happens to visit" from driving the endpoint. That check treats a
request with **no** `Origin` header as trusted. Per the Fetch spec, a
cross-origin **GET** that is not in CORS mode — an `<img src>`, `<script src>`,
`<iframe src>`, `<link>`, or a top-level navigation — carries no `Origin`
header at all. So the exact scenario the check was written to prevent still
works: any page open in another browser tab can issue
`<img src="http://localhost:5179/__lit-open-in-editor?file=...">` and the
request passes the guard.

The path confinement right below it is solid (it rejects traversal and files
outside the allowed roots) and stays as-is. What an attacker gains is still
narrow — opening an _existing_ file under the dev server's allowed roots in the
developer's editor, silently, at an attacker-chosen line. But the allowed roots
are `[config.root, ...server.fs.allow]` (`src/lib/plugin.ts:678-682`), which in
a monorepo is usually the whole workspace, and the endpoint's whole point is to
launch a process. Closing this costs one extra header check.

An identical copy of `isSameOrigin` guards the timeline/inspector endpoints in
`src/lib/timeline-plugin.ts`, so the same fix must land there. This plan
extracts the check into one shared module so it can never drift again.

## Current state

Files in play:

- `src/lib/plugin.ts` — the main plugin; contains `isSameOrigin` and
  `createOpenInEditorMiddleware`.
- `src/lib/timeline-plugin.ts` — the timeline/inspector plugin; contains a
  byte-identical second copy of `isSameOrigin`, used at four call sites.
- `src/test/unit/open-in-editor_test.ts` — existing unit tests for the
  middleware (this is the pattern to follow for new tests).

`src/lib/plugin.ts:294-309` today:

```ts
const OPEN_IN_EDITOR_PATH = '/__lit-open-in-editor';

/** Reject requests whose `Origin` is a different host than the dev server, so
 *  a page the developer happens to visit can't drive these local-only
 *  endpoints. Same-origin requests (no `Origin`, or matching `Host`) pass. */
const isSameOrigin = (headers: {origin?: string; host?: string}): boolean => {
  const {origin, host} = headers;
  if (origin === undefined || origin === 'null') return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};
```

`src/lib/plugin.ts:311-329` — the middleware signature and the guard call. Note
that `req` is duck-typed, **not** `http.IncomingMessage`; you will need to widen
this type to read the new header and the method:

```ts
export const createOpenInEditorMiddleware = (
  allowedRoots: readonly string[]
) => {
  const roots = allowedRoots.map((r) => resolvePath(r));
  return (
    req: {url?: string; headers?: {origin?: string; host?: string}},
    res: {statusCode: number; end: (msg: string) => void},
    next: (err?: unknown) => void
  ) => {
    if (req.url === undefined) {
      next();
      return;
    }
    if (!isSameOrigin(req.headers ?? {})) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
```

`src/lib/timeline-plugin.ts:180-196` — the duplicate (same body, different
comment). Its four call sites are at `src/lib/timeline-plugin.ts:223`
(SSE stream), `:330` (settings GET/POST), `:414` (control POST) and `:490`
(inspector command POST).

Repo conventions to match:

- Every source file starts with the license header block used by its
  neighbours. New files under `src/lib/` use the same header as
  `src/lib/source-meta.ts:1-5`:
  ```ts
  /**
   * @license
   * Copyright 2026 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  ```
  Copy it verbatim into any new file — do not invent a different copyright line.
- Arrow-function consts, not `function` declarations, for module-level helpers
  (see every helper in `src/lib/plugin.ts`).
- Formatting is enforced: single quotes, no bracket spacing, 80-column print
  width, ES5 trailing commas (configured in `vite.config.ts:64-80`).
- Unit tests import from `vite-plus/test`, not `vitest` — see
  `src/test/unit/open-in-editor_test.ts:10`.

## Commands you will need

| Purpose            | Command                                               | Expected on success    |
| ------------------ | ----------------------------------------------------- | ---------------------- |
| Install            | `pnpm install`                                        | exit 0                 |
| Format/lint/types  | `pnpm exec vp check`                                  | exit 0, no errors      |
| Unit tests         | `pnpm run test:unit`                                  | exit 0, all tests pass |
| One unit test file | `pnpm exec vp test run --project unit open-in-editor` | exit 0, all tests pass |
| Build              | `pnpm run build`                                      | exit 0                 |

Do **not** run `pnpm run test:e2e` for this plan — it builds the package and
drives real browsers for several minutes, and nothing in this change affects it.

## Scope

**In scope** (the only files you may modify or create):

- `src/lib/http.ts` (create)
- `src/lib/plugin.ts`
- `src/lib/timeline-plugin.ts`
- `src/test/unit/open-in-editor_test.ts`

**Out of scope** (do NOT touch, even though they look related):

- The path-confinement logic at `src/lib/plugin.ts:341-354` — it is correct and
  already covered by tests. Leave it exactly as it is.
- `src/lib/runtime/source-overlay/overlay-element.ts` — the browser-side caller.
  It issues a same-origin `fetch`, which sends both `Origin` and
  `Sec-Fetch-Site: same-origin`, so it needs no change. If you believe it does,
  that is a STOP condition.
- Repo-root `lib/`, `types/`, `panel/`, `index.js`, `index.d.ts` — these are
  generated `tsc` output, not source. Never edit them by hand.
- The `lit/` submodule, `node_modules/`, `playground/`.

## Git workflow

- Branch: `advisor/001-harden-dev-endpoint-origin-check`
- One commit per step is fine. Message style matches `git log`: a capitalized
  imperative summary line, no conventional-commit prefix. Example from history:
  `Anchor the lint and format ignore patterns to the repo root`.
- Do NOT push or open a PR.

## Steps

### Step 1: Create the shared request-trust helper

Create `src/lib/http.ts` with the license header (copied verbatim from
`src/lib/source-meta.ts:1-5`) and a single exported function:

```ts
/**
 * Headers the trust check looks at. Both the open-in-editor endpoint and the
 * timeline/inspector endpoints are local-only dev tooling: only the page the
 * dev server itself served may drive them.
 */
export interface TrustHeaders {
  origin?: string;
  host?: string;
  'sec-fetch-site'?: string;
}

/**
 * True when the request demonstrably comes from the dev server's own page.
 *
 * Two independent signals, because neither is present on every request:
 *   - `Origin` is sent on CORS-mode fetches and on every non-GET/HEAD request,
 *     but NOT on a plain cross-site GET (`<img>`, `<iframe>`, a navigation).
 *   - `Sec-Fetch-Site` is sent by Chromium and Firefox on every request and is
 *     the signal that covers exactly that gap; `same-origin` and `none` (a
 *     user-typed URL) are ours, `cross-site`/`same-site` are not.
 * A request is trusted only when every signal it does carry says same-origin,
 * and at least one of them is present.
 */
export const isTrustedRequest = (headers: TrustHeaders): boolean => {
  const site = headers['sec-fetch-site'];
  if (site !== undefined) {
    if (site !== 'same-origin' && site !== 'none') return false;
  }
  const {origin, host} = headers;
  if (origin !== undefined && origin !== 'null') {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
    return true;
  }
  // No `Origin`: trust only when `Sec-Fetch-Site` vouched for it above.
  return site !== undefined;
};
```

Read the code you just wrote once and confirm the three cases it must produce:
same-origin `Origin` → `true`; mismatched `Origin` → `false`; no `Origin` and
no `Sec-Fetch-Site` → `false`.

**Verify**: `pnpm exec vp check` → exit 0.

### Step 2: Use the helper in the open-in-editor middleware

In `src/lib/plugin.ts`:

1. Delete the local `isSameOrigin` (lines 296-309 in the excerpt above,
   including its comment block).
2. Add `import {isTrustedRequest, type TrustHeaders} from './http.js';` to the
   import block at the top of the file. The `.js` extension is required — this
   package is `"type": "module"` with `moduleResolution: NodeNext`.
3. Widen the middleware's `req` parameter type to
   `{url?: string; method?: string; headers?: TrustHeaders}`.
4. Replace the guard body with:
   ```ts
   if (req.method !== undefined && req.method !== 'GET') {
     res.statusCode = 405;
     res.end('method not allowed');
     return;
   }
   if (!isTrustedRequest(req.headers ?? {})) {
     res.statusCode = 403;
     res.end('forbidden');
     return;
   }
   ```
   Keep the 403 status and the exact body string `forbidden` — an existing test
   asserts on both.

**Verify**: `pnpm exec vp check` → exit 0. Then
`pnpm exec vp test run --project unit open-in-editor` → every existing test
still passes except possibly `rejects cross-origin requests`, which must still
pass (it sends a mismatched `Origin`).

### Step 3: Use the helper in the timeline/inspector endpoints

In `src/lib/timeline-plugin.ts`:

1. Delete the duplicate `isSameOrigin` at lines 180-196 (keep its explanatory
   comment by moving the useful sentence into the import site or dropping it —
   `src/lib/http.ts` now documents the rule).
2. Import `isTrustedRequest` (and `TrustHeaders` if the local `req` types name
   the header bag explicitly) from `./http.js`.
3. Update all four call sites (`:223`, `:330`, `:414`, `:490` before your edit
   shifts them — find them with
   `grep -n "isSameOrigin" src/lib/timeline-plugin.ts`) to call
   `isTrustedRequest`. Where the surrounding `req` type is declared inline as
   `headers?: {origin?: string; host?: string}`, widen it to
   `headers?: TrustHeaders`.

**Verify**:

- `grep -rn "isSameOrigin" src/` → no matches.
- `pnpm exec vp check` → exit 0.

### Step 4: Add regression tests for the gap

In `src/test/unit/open-in-editor_test.ts`, the existing `run()` helper takes
`headers: {origin?: string; host?: string}` (see lines 51-56). Widen that
parameter type to include `'sec-fetch-site'?: string` and `method?: string`
handling as needed by the cases below, then add these tests next to the
existing `rejects cross-origin requests` test:

1. `rejects a request with no Origin and no Sec-Fetch-Site` — headers `{host:
'localhost:5173'}`, a valid in-root `file` param → expect status 403, body
   `forbidden`, and `expect(launchMock).not.toHaveBeenCalled()`.
2. `rejects a cross-site GET that carries no Origin` — headers
   `{host: 'localhost:5173', 'sec-fetch-site': 'cross-site'}` → expect 403 and
   `launchMock` not called.
3. `allows a same-origin request that carries only Sec-Fetch-Site` — headers
   `{host: 'localhost:5173', 'sec-fetch-site': 'same-origin'}` → expect 200,
   body `ok`, and `expect(launchMock).toHaveBeenCalled()`.
4. `allows a direct navigation (Sec-Fetch-Site: none)` — headers
   `{host: 'localhost:5173', 'sec-fetch-site': 'none'}` → expect 200.

Follow the existing file's structure exactly: the `run(middleware, query,
headers)` helper, `launchMock` from `vi.hoisted`, and the temp-dir fixtures
already set up at the top of the file. Do not create a new test file.

**Verify**: `pnpm exec vp test run --project unit open-in-editor` → all tests
pass, including the 4 new ones.

### Step 5: Full unit suite and build

**Verify**:

- `pnpm run test:unit` → exit 0.
- `pnpm run build` → exit 0.
- `pnpm exec vp check` → exit 0.

## Test plan

- New tests: the four cases in Step 4, all in
  `src/test/unit/open-in-editor_test.ts`, modeled on the existing
  `rejects cross-origin requests` test in the same file.
- The timeline endpoints have no unit test file today; adding one is **out of
  scope** for this plan (it is tracked separately as a test-coverage finding).
  The shared helper's behavior is fully covered by the open-in-editor tests.
- Verification: `pnpm run test:unit` → exit 0, with 4 more passing tests than
  before.

## Done criteria

ALL must hold:

- [ ] `pnpm exec vp check` exits 0
- [ ] `pnpm run test:unit` exits 0 and includes the 4 new tests
- [ ] `pnpm run build` exits 0
- [ ] `grep -rn "isSameOrigin" src/` returns no matches
- [ ] `src/lib/http.ts` exists and exports `isTrustedRequest`
- [ ] `git status --porcelain` lists only: `src/lib/http.ts`, `src/lib/plugin.ts`,
      `src/lib/timeline-plugin.ts`, `src/test/unit/open-in-editor_test.ts`
      (plus gitignored build output)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `src/lib/plugin.ts` or `src/lib/timeline-plugin.ts`
  changed since commit `08f53c5` and the excerpts above no longer match.
- Any existing test in `src/test/unit/open-in-editor_test.ts` fails after your
  change. That test file encodes the security boundary; a failure means the new
  check is wrong, not that the test is.
- You conclude that the browser-side caller in
  `src/lib/runtime/source-overlay/overlay-element.ts` or
  `src/panel/**` needs to start sending an extra header for its own requests to
  pass. That would mean the helper is too strict — report instead of loosening
  it or editing out-of-scope files.
- `pnpm exec vp check` reports type errors you cannot resolve within the
  in-scope files after two attempts.

## Maintenance notes

- `Sec-Fetch-Site` is sent by Chromium and Firefox. A browser that sends
  neither `Origin` nor `Sec-Fetch-Site` on a same-origin GET would now be
  rejected; that is the intended trade-off for a local dev-only endpoint, but
  it is the thing to revisit if someone reports "open in editor stopped working
  in browser X".
- Any new dev-server route added to `src/lib/plugin.ts` or
  `src/lib/timeline-plugin.ts` must call `isTrustedRequest` as its first guard.
  Reviewers should check for that.
- Deliberately deferred: unit tests for the timeline/inspector middlewares
  themselves, and any rate-limiting or confirmation UX on the editor endpoint.
