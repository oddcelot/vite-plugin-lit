# Plan 005: Finish the package rename — dead specifiers and wrong docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 08f53c5..HEAD -- src/lib/plugin.ts src/lib/runtime/css.ts client.d.ts README.md`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `08f53c5`, 2026-09-17

## Why this matters

This package was renamed from `@lit-labs/vite-plugin-lit` to
`@oddsquad/vite-plugin-lit` (commit `aa2890a`). Five code sites and several
doc sites still name the old scope:

- `src/lib/plugin.ts` matches the **old** bare specifiers in `resolveId` and
  excludes the **old** package name from `optimizeDeps`. Consumers import the
  **new** name (`playground/src/hmr-utility-sheet.ts:7`,
  `playground/src/hmr-css-url.ts:9`, `README.md:190`), so those branches never
  fire. They are dead code that reads as live safety net — the comments above
  them explain a fallback ("so they work even when the package isn't reachable
  through node resolution from the served root") that no longer exists for the
  package's real name.
- `src/lib/runtime/css.ts` shows the old name in the usage examples of its two
  public helpers. Those doc comments ship to npm inside `lib/runtime/css.js` and
  `lib/runtime/css.d.ts`, so a consumer's editor tooltip tells them to import a
  package that isn't installed.
- `client.d.ts` — also shipped — tells consumers to reference
  `"@lit-labs/vite-plugin-lit/client"` in their tsconfig. Following it silently
  gives them no ambient types for `*.css?css-sheet` / `*.css?hmr-url`.
- `README.md:474` documents the formatter as `prettier`; the repo has no
  prettier dependency and formats with `vp fmt` (oxfmt), configured in
  `vite.config.ts:64-80`.
- `README.md` repeats a paragraph verbatim in the Playground section.

None of this is dangerous; all of it costs a reader time and hides a real
capability gap behind strings that look intentional.

## Current state

The five code sites (verified at commit `08f53c5`):

```
src/lib/plugin.ts:667       if (id === '@lit-labs/vite-plugin-lit/source-overlay.js') {
src/lib/plugin.ts:746       return {optimizeDeps: {exclude: ['@lit-labs/vite-plugin-lit']}};
src/lib/plugin.ts:757       if (id === '@lit-labs/vite-plugin-lit/css.js') {
src/lib/plugin.ts:760       if (id === '@lit-labs/vite-plugin-lit/indicator.js') {
src/lib/plugin.ts:763       if (id === '@lit-labs/vite-plugin-lit/source-overlay.js') {
```

Context around `src/lib/plugin.ts:742-765`:

```ts
      // The injected runtime imports are invisible to the dep scanner. The
      // lit family stays prebundle-eligible on purpose: the wrapper modules'
      // bare imports then resolve to the same URL every other importer gets —
      // single lit instance, single template cache.
      return {optimizeDeps: {exclude: ['@lit-labs/vite-plugin-lit']}};
    },
    resolveId(id) {
      // Public timeline API virtual module.
      if (id === 'virtual:lit-plugin/timeline') {
        return '\0virtual:lit-plugin/timeline';
      }
      // Resolve the browser CSS helpers and indicator runtime to the copy
      // shipped next to this plugin, so they work even when the package
      // isn't reachable through node resolution from the served root (and
      // stay out of prebundling).
      if (id === '@lit-labs/vite-plugin-lit/css.js') {
        return resolveRuntimeModule('css');
      }
```

The two doc sites in shipped runtime code:

```
src/lib/runtime/css.ts:46    * import {devCacheBust} from '@lit-labs/vite-plugin-lit/css.js';
src/lib/runtime/css.ts:120   * import {urlSheet} from '@lit-labs/vite-plugin-lit/css.js';
```

`client.d.ts:8-13`:

```ts
/**
 * Ambient types for the import queries provided by the Lit Vite plugin.
 *
 * Reference via tsconfig (`"types": ["@lit-labs/vite-plugin-lit/client"]`) or
 * `/// <reference types="@lit-labs/vite-plugin-lit/client" />`.
 */
```

`README.md:474` (in the Development section):

```
pnpm format:check    # prettier
```

`README.md` Playground section, around lines 397-404 — this paragraph appears
twice in a row:

```
Edit the templates, styles, and labels in `playground/src/*.ts` and watch
counts, focus, and DOM identity survive. The page HUD counts HMR updates;
every component shows a `renders: n` badge.
```

Names that are **correct as they are** and must not be touched:

- `src/lib/source-meta.ts:10` — `SOURCE_META_KEY = '@lit-labs/vite-plugin-lit#source'`.
- Any `Symbol.for('@lit-labs/vite-plugin-lit#…')` key, e.g.
  `src/lib/runtime/intern.ts:33`.

These are opaque protocol keys shared between transform-generated code and the
browser runtime, not module specifiers. Renaming them changes nothing for the
better and risks a mismatch between a built artifact and freshly transformed
code. Leave them exactly as they are.

## Commands you will need

| Purpose           | Command              | Expected on success |
| ----------------- | -------------------- | ------------------- |
| Install           | `pnpm install`       | exit 0              |
| Format/lint/types | `pnpm exec vp check` | exit 0              |
| Unit tests        | `pnpm run test:unit` | exit 0              |
| Build             | `pnpm run build`     | exit 0              |
| e2e tests         | `pnpm run test:e2e`  | exit 0 (slow)       |

## Scope

**In scope**:

- `src/lib/plugin.ts`
- `src/lib/runtime/css.ts`
- `client.d.ts`
- `README.md`

**Out of scope** (do NOT touch):

- `src/lib/source-meta.ts` and any `Symbol.for(...)` key anywhere — see above.
- `package.json` — the `exports` map is correct; do not add or reorder entries.
- Any other README content. This plan fixes exactly two README defects (the
  `prettier` comment and the duplicated paragraph). Do not restructure, reword,
  or "improve" other sections.
- Repo-root `lib/`, `types/`, `panel/`, `index.js`, `index.d.ts` — generated
  build output; they regenerate from `src/`.

## Git workflow

- Branch: `advisor/005-finish-package-rename`
- Commit message style: capitalized imperative summary, no conventional-commit
  prefix (e.g. `Point the plugin's own bare specifiers at the current scope`).
- Do NOT push or open a PR.

## Steps

### Step 1: Update the five specifier sites in `plugin.ts`

Replace `@lit-labs/vite-plugin-lit` with `@oddsquad/vite-plugin-lit` at
`src/lib/plugin.ts:667`, `:746`, `:757`, `:760`, `:763`.

Then extend the comment above the `resolveId` block so the next rename does not
miss them. Add a sentence such as:

```ts
// These bare specifiers must match the package name in package.json —
// consumers import them by name (see README "Stylesheets"), and Vite
// only consults this hook for the exact string.
```

**Verify**:

- `grep -n "@lit-labs/vite-plugin-lit" src/lib/plugin.ts` → no matches.
- `pnpm exec vp check` → exit 0.

### Step 2: Fix the shipped usage examples in `runtime/css.ts`

Update the two JSDoc example imports at `src/lib/runtime/css.ts:46` and `:120`
to `@oddsquad/vite-plugin-lit/css.js`. Change nothing else in that file.

**Verify**:

- `grep -n "@lit-labs" src/lib/runtime/css.ts` → no matches.
- `git diff --stat src/lib/runtime/css.ts` → 2 lines changed.

### Step 3: Fix the reference instructions in `client.d.ts`

Update both occurrences in the header comment to
`@oddsquad/vite-plugin-lit/client`. This file ships to npm (it is listed in
`package.json`'s `files`), and `playground/tsconfig.json:12` already uses the
correct form (`"types": ["vite/client", "@oddsquad/vite-plugin-lit/client"]`) —
match it.

**Verify**:

- `grep -n "@lit-labs" client.d.ts` → no matches.
- `grep -n "@oddsquad/vite-plugin-lit/client" client.d.ts` → 2 matches.

### Step 4: Fix the two README defects

1. Line 474: change `pnpm format:check    # prettier` so the comment names the
   real tool, e.g. `pnpm format:check    # oxfmt, via vp fmt`.
2. Delete the duplicated paragraph in the Playground section (keep one copy of
   the "Edit the templates, styles, and labels…" paragraph — remove the second
   occurrence and any blank line it leaves behind).

**Verify**:

- `grep -c "prettier" README.md` → 0.
- `grep -c "Edit the templates, styles, and labels" README.md` → 1.

### Step 5: Repo-wide sweep and full gate

**Verify**:

- `grep -rn "@lit-labs/vite-plugin-lit" src client.d.ts README.md` → the only
  remaining matches are `src/lib/source-meta.ts:10` and the `Symbol.for(...)`
  keys (they are intentional; list them in your report).
- `pnpm exec vp check` → exit 0
- `pnpm run test:unit` → exit 0
- `pnpm run build` → exit 0
- `pnpm run test:e2e` → exit 0

## Test plan

This plan adds no new tests: every change is a string literal or documentation,
and the behavior it restores (bare-specifier fallback resolution) has no test
harness today.

The regression net is the existing suite. In particular `pnpm run test:e2e`
covers the CSS helper paths through the playground fixtures
(`css-sheet-query_test.ts`, `css-sheet-build_test.ts`, `utility-sheet_test.ts`,
`styles_test.ts`), which is what would break if a specifier change were wrong.

## Done criteria

ALL must hold:

- [ ] `grep -rn "@lit-labs/vite-plugin-lit" src/lib/plugin.ts src/lib/runtime/css.ts client.d.ts README.md`
      returns no matches
- [ ] `grep -n "@lit-labs/vite-plugin-lit#source" src/lib/source-meta.ts`
      still returns a match (the protocol key is unchanged)
- [ ] `grep -c "prettier" README.md` → 0
- [ ] `grep -c "Edit the templates, styles, and labels" README.md` → 1
- [ ] `pnpm exec vp check` exits 0
- [ ] `pnpm run test:unit` exits 0
- [ ] `pnpm run test:e2e` exits 0
- [ ] `git status --porcelain` lists only the four in-scope files (plus
      gitignored build output)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any e2e test that passed before your change fails after it. The specifier
  change is meant to be inert for the current import paths; a failure means
  something resolves through those branches in a way this plan did not
  anticipate.
- `grep` shows the old scope in files outside the in-scope list (other than
  `src/lib/source-meta.ts` and `Symbol.for` keys) — report the list instead of
  widening the change.
- You are tempted to also rename the `Symbol.for('@lit-labs/vite-plugin-lit#…')`
  keys. Do not; report it as a question.

## Maintenance notes

- After this lands, `optimizeDeps.exclude` actually names the installed package
  again. Its effect is to keep the plugin's own browser helpers out of Vite's
  dep prebundling; `src/lib/runtime/css.ts` holds no module-level state, so no
  behavior change is expected — but if someone later adds a module-level cache
  to a runtime helper, this exclusion is what keeps it a singleton.
- A reviewer should confirm that no `Symbol.for(...)` key changed in the diff.
- Related, deliberately not in this plan: the public timeline API
  (`virtual:lit-plugin/timeline`, documented at `README.md:147-168`) has no
  ambient module declaration in `client.d.ts`, so TypeScript consumers who
  follow the README get `TS2307: Cannot find module`. Adding it is a small,
  separate piece of work.
