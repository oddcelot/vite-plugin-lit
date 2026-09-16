# Plan 002: Add a CI verification baseline for a published package

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 08f53c5..HEAD -- package.json vite.config.ts src/test/e2e/utils.ts`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `08f53c5`, 2026-09-17

## Why this matters

`@oddsquad/vite-plugin-lit` is published to npm, and this repository has **no
CI at all** — there is no `.github/` directory. The only automated gate is a
local pre-commit hook (`.vite-hooks/pre-commit`, which runs `vp staged`), which
only exists if `pnpm install` wired it and which `git commit --no-verify`
bypasses. `prepublishOnly` runs `pnpm run build` and nothing else, so a failing
test or a type error can reach npm.

Every other plan in this directory is safer to execute once a machine-checked
gate exists, so this one goes first. After it lands, "did I break anything" has
a single answer that is not "trust the contributor's laptop".

## Current state

There is no `.github/` directory (`ls -a` at the repo root confirms it).

`package.json` scripts as they exist today (lines 37-50):

```json
"scripts": {
  "build": "tsc --pretty && node scripts/copy-panel-html.mjs && node scripts/format-build-output.mjs",
  "build:lit-canary": "node scripts/build-lit-canary.mjs",
  "dev": "pnpm run build && vp dev playground",
  "test": "pnpm run test:unit && pnpm run test:e2e",
  "test:unit": "vp test run --project unit",
  "test:e2e": "pnpm run build && vp test run --project e2e",
  "bench": "node bench/run.mjs",
  "bench:serve": "node bench/run.mjs --serve",
  "format": "vp fmt \"**/*.{cjs,html,js,json,md,ts,yaml}\"",
  "format:check": "vp fmt \"**/*.{cjs,html,js,json,md,ts,yaml}\" --check",
  "prepublishOnly": "pnpm run build",
  "prepare": "vp config"
}
```

Toolchain facts, all verified:

- Package manager is pinned: `"packageManager": "pnpm@12.3.4"` in
  `package.json`. `corepack enable` picks it up.
- `devEngines.runtime` requires Node `>=26` for developing this repo
  (`engines.node` is `>=20`, but that is the _consumer_ requirement — CI must
  use Node 26).
- `vite-plus` is a devDependency, so `pnpm exec vp ...` works after install;
  there is no need to install a global CLI.
- `vp check` runs format + lint + typecheck and is **read-only** without
  `--fix` (verified: `vp check --help` lists `--fix` as the opt-in auto-fix
  flag).
- The repo is a pnpm workspace: root package plus `playground`
  (`pnpm-workspace.yaml`). `pnpm install` at the root installs both.
- The e2e suite launches real Chrome. `src/test/e2e/utils.ts:90-97`:
  ```ts
  const executablePath = process.env['HMR_E2E_EXECUTABLE'];
  const browser = await chromium.launch({
    ...(executablePath !== undefined && executablePath !== ''
      ? {executablePath}
      : {channel: 'chrome'}),
    headless: process.env['HMR_E2E_HEADED'] === undefined,
  });
  ```
  GitHub's `ubuntu-latest` runner image ships Google Chrome stable, so
  `channel: 'chrome'` resolves with no extra install step.
- e2e is deliberately sequential and slow: `vite.config.ts:24-33` sets
  `fileParallelism: false`, `testTimeout: 30_000`, `hookTimeout: 60_000`, and
  there are 19 e2e files each starting its own Vite dev server and browser.
  That is why it gets its own job.

Repo conventions:

- Formatting covers YAML: the `format` script globs `**/*.{cjs,html,js,json,md,ts,yaml}`
  and `vite.config.ts:70-80` configures oxfmt. A new workflow file will be
  format-checked, so run the formatter before finishing.
- Note the glob covers `.yaml`, not `.yml`. Name the workflow file
  `ci.yaml` so it is covered by the same formatting gate.

## Commands you will need

| Purpose           | Command                 | Expected on success    |
| ----------------- | ----------------------- | ---------------------- |
| Install           | `pnpm install`          | exit 0                 |
| Format/lint/types | `pnpm exec vp check`    | exit 0                 |
| Format check only | `pnpm run format:check` | exit 0                 |
| Unit tests        | `pnpm run test:unit`    | exit 0                 |
| Build             | `pnpm run build`        | exit 0                 |
| e2e tests         | `pnpm run test:e2e`     | exit 0 (slow: minutes) |

## Scope

**In scope** (the only files you may modify or create):

- `.github/workflows/ci.yaml` (create)
- `package.json` (one script change, Step 3 only)

**Out of scope** (do NOT touch):

- `vite.config.ts` — do not change `fileParallelism`, timeouts, or lint config
  to make CI faster or greener. If e2e is too slow or flaky on CI, that is a
  STOP condition, not a config change.
- Any test file. This plan adds a gate; it does not fix or skip tests.
- `.vite-hooks/` — the local hook stays as it is.
- Release/publish automation, npm tokens, or any workflow that publishes.
  This plan adds verification only. Do not add a publish workflow, and do not
  add any secret reference to the workflow file.

## Git workflow

- Branch: `advisor/002-ci-verification-baseline`
- Commit message style matches `git log`: capitalized imperative summary, no
  conventional-commit prefix. Example: `Anchor the lint and format ignore
patterns to the repo root`.
- Do NOT push or open a PR.

## Steps

### Step 1: Confirm the gate commands actually pass locally

Before writing the workflow, verify the commands it will run are green on this
checkout, so a later red CI is unambiguous.

Run, in order:

1. `pnpm install` → exit 0
2. `pnpm exec vp check` → exit 0
3. `pnpm run test:unit` → exit 0
4. `pnpm run build` → exit 0

If any of these fails on a clean checkout, **STOP and report** — do not fix the
underlying failure as part of this plan and do not write a workflow around a
known-red command.

**Verify**: all four commands exit 0.

### Step 2: Add the CI workflow

Create `.github/workflows/ci.yaml` with two jobs.

Job `check` (fast, runs on every push and PR):

- `runs-on: ubuntu-latest`
- steps: `actions/checkout@v4` → `corepack enable` → `actions/setup-node@v4`
  with `node-version: 26` and `cache: pnpm` → `pnpm install --frozen-lockfile`
  → `pnpm exec vp check` → `pnpm run test:unit` → `pnpm run build`

Job `e2e` (slow, same triggers, independent of `check` so both report
separately):

- `runs-on: ubuntu-latest`
- `timeout-minutes: 30`
- same checkout/corepack/node/install steps, then `pnpm run test:e2e`
- no browser-install step: the runner image provides Chrome and
  `src/test/e2e/utils.ts` uses `channel: 'chrome'`

Workflow-level requirements:

- Trigger on `push` to `main` and on `pull_request`.
- Do **not** check out the `lit` submodule. `.gitmodules` sets
  `update = none`; it is a large opt-in canary reference and the default test
  run does not need it. Leave `actions/checkout`'s `submodules` input unset.
- Do not reference any secret.

**Verify**:

- `pnpm run format:check` → exit 0 (the new YAML file is covered by the glob;
  run `pnpm run format` first if it reports a diff).
- `cat .github/workflows/ci.yaml` → the file contains both `check` and `e2e`
  jobs and the exact commands listed above.

### Step 3: Make `prepublishOnly` verify, not just build

In `package.json`, change:

```json
"prepublishOnly": "pnpm run build",
```

to:

```json
"prepublishOnly": "pnpm exec vp check && pnpm run test:unit && pnpm run build",
```

Rationale to keep in mind: e2e is deliberately excluded — it needs a real
browser and minutes of wall time, which is the wrong gate to put in front of a
publish. CI covers e2e.

**Verify**:

- `pnpm exec vp check` → exit 0 (this also format-checks `package.json`).
- `node -e "const p=require('./package.json');if(!p.scripts.prepublishOnly.includes('test:unit'))process.exit(1)"`
  → exit 0.

### Step 4: Final gate

**Verify**:

- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0
- `pnpm run build` → exit 0
- `git status --porcelain` → lists only `.github/workflows/ci.yaml` and
  `package.json` (plus gitignored build output)

## Test plan

This plan adds no test code. Its verification is that the gate commands it
wires up are green locally (Steps 1 and 4) and that the workflow file contains
exactly those commands.

Optionally, if `act` or an equivalent local workflow runner happens to be
installed, running the `check` job locally is a bonus signal — but do not
install anything to get it. The plan does not depend on it.

## Done criteria

ALL must hold:

- [ ] `.github/workflows/ci.yaml` exists with a `check` job and an `e2e` job
- [ ] The `check` job runs `pnpm exec vp check`, `pnpm run test:unit`, and
      `pnpm run build`
- [ ] The `e2e` job runs `pnpm run test:e2e` with `timeout-minutes: 30`
- [ ] Both jobs use Node 26 and `pnpm install --frozen-lockfile`
- [ ] `grep -c "secrets\." .github/workflows/ci.yaml` → 0
- [ ] `package.json`'s `prepublishOnly` includes `vp check` and `test:unit`
- [ ] `pnpm exec vp check` exits 0
- [ ] `pnpm run test:unit` exits 0
- [ ] `git status --porcelain` lists only the two in-scope files
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any command in Step 1 fails on a clean checkout. Report which one and its
  output. Do not fix it here and do not weaken the workflow to accommodate it.
- `pnpm install --frozen-lockfile` fails because the lockfile is out of date.
  Do not regenerate the lockfile as part of this plan.
- `pnpm run test:e2e` cannot run in your environment (no Chrome available).
  Write the workflow anyway, note in your report that the e2e job is unverified
  locally, and do not add a browser-download step to work around it.
- You find yourself wanting to change `vite.config.ts`, a test, or a timeout to
  make something pass.

## Maintenance notes

- The e2e job is the one that will go flaky first: 19 sequential files, real
  browsers, real file-watch round trips, with `expect.poll` timeouts of 10-15s
  tuned on developer laptops. If it flakes on CI hardware, the right first move
  is raising `timeout-minutes` and the polls in `vite.config.ts` deliberately —
  not retrying the job blindly.
- When branch protection is configured later, require the `check` job; decide
  separately whether `e2e` is required, based on its observed flake rate.
- Deliberately deferred: a scheduled canary job running the suite against the
  `lit` submodule at `main` (`pnpm run build:lit-canary` + `LIT_CANARY=1`),
  publish automation, and any caching beyond `actions/setup-node`'s pnpm cache.
