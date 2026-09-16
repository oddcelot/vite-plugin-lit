# Plan 003: Stop source-meta injection from referencing out-of-scope classes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 08f53c5..HEAD -- src/lib/source-meta.ts src/test/unit/source-meta_test.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (the change alters generated code placement for every
  component in a project that enables `sourceOverlay`)
- **Depends on**: none (but land 002 first if you want a CI gate behind this)
- **Category**: bug
- **Planned at**: commit `08f53c5`, 2026-09-17

## Why this matters

When `sourceOverlay` is enabled, the plugin appends a metadata assignment like
`MyEl[Symbol.for('@lit-labs/vite-plugin-lit#source')]={filePath:"…",lineNumber:12,componentName:"MyEl"};`
to every module that declares a custom element, so the click-to-open-in-IDE
overlay can map a DOM element back to its source.

The assignment is always appended at the **end of the module**, regardless of
where the class was declared. `src/lib/source-meta.ts` contains a careful
brace/string/comment/template-aware scanner, `findClassBodyEnd`, that computes
the exact index after a class body — but that value is only used as a
"did we find a class at all" check and is then thrown away.

The consequence: a component class declared inside a function or block scope
(a factory such as `function defineIcon(name) { class Icon extends LitElement
{…}; customElements.define(name, Icon); }`) gets `Icon[…]=…;` appended at module
top level, where `Icon` is not in scope. That throws a `ReferenceError` at
module evaluation — the whole module fails to load, not just the overlay
feature. The guard that is supposed to prevent this,
`isClassDeclaredInModule`, matches with a leading `^\s*`, so an indented
(i.e. nested) declaration passes it.

After this plan: metadata for decorator-declared classes is inserted in the same
scope as the class, and the two module-end injection paths only fire for
declarations that are actually at module top level.

## Current state

File: `src/lib/source-meta.ts` (229 lines) — Node-side; runs from
`src/lib/plugin.ts:706` inside the source-overlay plugin's `transform` hook,
with `enforce: 'pre'` so it sees the author's original TypeScript.

`src/lib/source-meta.ts:28-34` (the scanner's contract):

```ts
/**
 * Finds the index after the closing `}` of a class body starting at
 * `classStart`. Skips braces inside strings, comments, regex literals, and
 * template literals — including code in `${…}` interpolations, where nested
 * templates (Lit's `html\`…\`` inside `.map()` etc.) recurse arbitrarily.
 */
const findClassBodyEnd = (code: string, classStart: number): number => {
```

`src/lib/source-meta.ts:152-157` (the too-loose top-level guard):

```ts
/** True when `className` is declared as a class/let/const in module code. */
const isClassDeclaredInModule = (code: string, className: string): boolean =>
  new RegExp(
    `^\\s*(?:export\\s+)?(?:class|let|const|var)\\s+${className}\\b`,
    'm'
  ).test(code);
```

`src/lib/source-meta.ts:163-229` (the three injection paths — note all three
call `ms.append`, which appends at the end of the whole module, and note that
`end` is computed and then unused):

```ts
export const injectSourceMeta = (
  code: string,
  filePath: string,
  ms: MagicString
): boolean => {
  if (code.includes(SOURCE_META_SYM)) {
    return false;
  }
  let changed = false;
  const injected = new Set<string>();

  const injectAtClassEnd = (
    className: string,
    matchIndex: number,
    match: string
  ) => {
    if (injected.has(className)) return;
    const classOffset = match.indexOf('class');
    if (classOffset === -1) return;
    const classStart = matchIndex + classOffset;
    const end = findClassBodyEnd(code, classStart);
    if (end === -1) return;
    // Report the match start (the `@customElement` decorator) rather than the
    // `class` keyword, so the overlay points at the top of the component.
    const line = lineNumberAt(code, matchIndex);
    ms.append('\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  };

  // @customElement(...) class Foo (any whitespace between them)
  for (const m of code.matchAll(
    /@customElement\s*\([^)]*\)\s+(?:export\s+)?class\s+(\w+)/g
  )) {
    injectAtClassEnd(m[1], m.index, m[0]);
  }

  // customElements.define('tag', ClassName)
  for (const m of code.matchAll(
    /customElements\.define\s*\(\s*['"][^'"]+['"]\s*,\s*(\w+)/g
  )) {
    const className = m[1];
    if (injected.has(className) || !isClassDeclaredInModule(code, className)) {
      continue;
    }
    const line = lineNumberAt(code, m.index);
    ms.append('\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  }

  // TypeScript experimental-decorators / esbuild output
  // e.g. `Foo = __decorateClass([customElement(...)], Foo)`
  //       `Foo = _decorate([customElement(...)], Foo)`
  for (const m of code.matchAll(
    /(\w+)\s*=\s*__decorate\w*\(\s*\[[\s\S]*?customElement\s*\([^)]*\)[\s\S]*?\],\s*\1\)/g
  )) {
    const className = m[1];
    if (injected.has(className)) continue;
    const line = lineNumberAt(code, m.index);
    ms.append('\n' + makeAssignment(className, filePath, line));
    injected.add(className);
    changed = true;
  }

  return changed;
};
```

Repo conventions:

- Arrow-function consts for module-level helpers; no `function` declarations.
- License header block at the top of every file (already present here).
- Unit tests import from `vite-plus/test` (not `vitest`) — see
  `src/test/unit/source-meta_test.ts:7`.
- The existing test helper in that file is:
  ```ts
  const run = (code: string, filePath = '/app/src/my-el.ts') => {
    const ms = new MagicString(code);
    const changed = injectSourceMeta(code, filePath, ms);
    return {changed, out: ms.toString()};
  };
  ```
  Reuse it for new tests; do not write a new harness.

## Commands you will need

| Purpose           | Command                                            | Expected on success |
| ----------------- | -------------------------------------------------- | ------------------- |
| Install           | `pnpm install`                                     | exit 0              |
| Format/lint/types | `pnpm exec vp check`                               | exit 0              |
| This test file    | `pnpm exec vp test run --project unit source-meta` | exit 0, all pass    |
| Unit tests        | `pnpm run test:unit`                               | exit 0              |
| Build             | `pnpm run build`                                   | exit 0              |
| e2e (final gate)  | `pnpm run test:e2e`                                | exit 0 (slow)       |

## Scope

**In scope**:

- `src/lib/source-meta.ts`
- `src/test/unit/source-meta_test.ts`

**Out of scope** (do NOT touch):

- `findClassBodyEnd` itself (`src/lib/source-meta.ts:34-143`). It is correct and
  hard-won — past commits fixed real bugs in it (`Fix: stop mistaking division
for a regex literal`, `scan template interpolations when locating class
ends`). This plan changes only how its **result** is used.
- `src/lib/plugin.ts` — the caller needs no change.
- `src/lib/runtime/source-meta.ts` — the browser-side reader. Its contract
  (read the symbol off the constructor) is unchanged by this plan.
- Repo-root `lib/`, `types/`, `panel/`, `index.js` — generated build output.

## Git workflow

- Branch: `advisor/003-source-meta-scope-escape`
- Commit message style: capitalized imperative summary, no conventional-commit
  prefix (e.g. `Inject source metadata in the class's own scope`).
- Do NOT push or open a PR.

## Steps

### Step 1: Add a failing test for the nested-class crash

In `src/test/unit/source-meta_test.ts`, add a test that reproduces the bug
using the existing `run()` helper:

```ts
test('does not reference a function-scoped class at module top level', () => {
  const code =
    `import {LitElement} from 'lit';\n` +
    `export const defineIcon = (name) => {\n` +
    `  class Icon extends LitElement {}\n` +
    `  customElements.define(name, Icon);\n` +
    `};\n`;
  const {out} = run(code);
  // The assignment must never appear after the closing brace of the arrow
  // function, where `Icon` is out of scope.
  const assignment = out.indexOf(`Icon[${SOURCE_META_SYM}]=`);
  if (assignment !== -1) {
    expect(assignment).toBeLessThan(out.indexOf('};'));
  }
});
```

Note: `customElements.define(name, Icon)` uses an identifier for the tag, which
the current `customElements.define` regex (which requires a quoted string tag)
does **not** match — so write a second, sharper case that the current code does
mis-handle:

```ts
test('skips a nested class declared inside a block', () => {
  const code =
    `import {LitElement} from 'lit';\n` +
    `if (true) {\n` +
    `  class Icon extends LitElement {}\n` +
    `  customElements.define('x-icon', Icon);\n` +
    `}\n`;
  const {changed, out} = run(code);
  expect(changed).toBe(false);
  expect(out).not.toContain(`Icon[${SOURCE_META_SYM}]=`);
});
```

**Verify**: `pnpm exec vp test run --project unit source-meta` → the
`skips a nested class declared inside a block` test **fails** (the assignment is
emitted today). Record the failure output in your report. If it passes, that is
a STOP condition — the behavior does not match this plan's premise.

### Step 2: Require module top level in `isClassDeclaredInModule`

Change the regex so an indented declaration no longer matches, and rename the
comment to say what it now means:

```ts
/**
 * True when `className` is declared at module top level (column 0). Nested
 * declarations are skipped deliberately: the metadata assignment for this path
 * is appended at the end of the module, where a function/block-scoped binding
 * would not be in scope (a `ReferenceError` at module evaluation).
 */
const isClassDeclaredInModule = (code: string, className: string): boolean =>
  new RegExp(
    `^(?:export\\s+)?(?:class|let|const|var)\\s+${className}\\b`,
    'm'
  ).test(code);
```

**Verify**:

- `pnpm exec vp test run --project unit source-meta` → the test from Step 1 now
  passes, and every pre-existing test in the file still passes.
- `pnpm exec vp check` → exit 0.

### Step 3: Insert decorator-path metadata in the class's own scope

In `injectAtClassEnd`, use the already-computed `end` instead of appending at
module end:

```ts
const end = findClassBodyEnd(code, classStart);
if (end === -1) return;
// Report the match start (the `@customElement` decorator) rather than the
// `class` keyword, so the overlay points at the top of the component.
const line = lineNumberAt(code, matchIndex);
// Insert right after the class body so the assignment lives in the same
// scope as the declaration — appending at module end breaks for a class
// declared inside a function or block.
ms.appendLeft(end, '\n' + makeAssignment(className, filePath, line));
```

Leave everything else in that function unchanged.

**Verify**:

- `pnpm exec vp test run --project unit source-meta` → all tests pass.
- `pnpm exec vp check` → exit 0.

### Step 4: Require line-start for the `__decorate` output path

That path matches transpiled output (`Foo = __decorateClass([...], Foo)`) and
also appends at module end. Add a small helper next to `lineNumberAt` and use
it to skip nested matches:

```ts
/** True when `index` starts a line (module top level in emitted output). */
const isAtLineStart = (code: string, index: number): boolean =>
  index === 0 || code[index - 1] === '\n';
```

Then in the `__decorate` loop, skip when the match is indented:

```ts
const className = m[1];
if (injected.has(className) || !isAtLineStart(code, m.index)) continue;
```

**Verify**:

- `pnpm exec vp test run --project unit source-meta` → all pass.
- `pnpm exec vp check` → exit 0.

### Step 5: Add coverage for the decorator path's new insertion point

Add one more test asserting the decorator-path assignment is no longer at the
very end of the module when other code follows the class:

```ts
test('decorator path injects right after the class body', () => {
  const code =
    `import {LitElement} from 'lit';\n` +
    `import {customElement} from 'lit/decorators.js';\n` +
    `@customElement('my-el')\nexport class MyEl extends LitElement {}\n` +
    `export const AFTER = 1;\n`;
  const {changed, out} = run(code);
  expect(changed).toBe(true);
  expect(out.indexOf(`MyEl[${SOURCE_META_SYM}]=`)).toBeLessThan(
    out.indexOf('export const AFTER')
  );
});
```

**Verify**: `pnpm exec vp test run --project unit source-meta` → all pass.

### Step 6: Full gate, including e2e

The source overlay is exercised end to end by the playground fixtures, so e2e
is the real regression net for the changed insertion point.

**Verify**:

- `pnpm run test:unit` → exit 0
- `pnpm exec vp check` → exit 0
- `pnpm run test:e2e` → exit 0 (this builds first and takes several minutes)

## Test plan

New tests, all in `src/test/unit/source-meta_test.ts`, following the existing
`run()` helper and `describe('injectSourceMeta', …)` structure:

1. `skips a nested class declared inside a block` — the regression this plan
   fixes (Step 1).
2. `does not reference a function-scoped class at module top level` — the
   arrow-function factory shape (Step 1).
3. `decorator path injects right after the class body` — the new insertion
   point (Step 5).

Existing tests in that file must all keep passing unchanged — they assert with
`toContain`, which is position-independent, so a correct implementation will not
need them edited. **Editing an existing assertion to make it pass is a STOP
condition.**

## Done criteria

ALL must hold:

- [ ] `pnpm exec vp check` exits 0
- [ ] `pnpm run test:unit` exits 0, with 3 more passing tests in
      `source-meta_test.ts` than before
- [ ] `pnpm run test:e2e` exits 0
- [ ] `grep -n "ms.append(" src/lib/source-meta.ts` → the decorator path no
      longer appears (only the two module-end paths remain)
- [ ] `grep -n "isAtLineStart" src/lib/source-meta.ts` → helper exists and is
      used in the `__decorate` loop
- [ ] No existing test assertion was modified (`git diff src/test/unit/source-meta_test.ts`
      shows additions only)
- [ ] `git status --porcelain` lists only the two in-scope files (plus
      gitignored build output)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The Step 1 test passes before you make any source change — the premise of this
  plan does not hold on the current code.
- Any pre-existing test in `src/test/unit/source-meta_test.ts` fails after your
  change, or you feel the need to modify one.
- An e2e test fails in Step 6 after passing before your change. Report which
  file and the failure; do not adjust timeouts or fixtures.
- You conclude the fix requires changing `findClassBodyEnd`, `src/lib/plugin.ts`,
  or the browser-side reader.

## Maintenance notes

- Two injection paths (`customElements.define` and `__decorate` output) still
  append at module end and now deliberately skip nested declarations — those
  components lose their overlay metadata rather than crashing the module. If
  someone later wants nested support for those paths too, the fix is the same
  as Step 3: find the enclosing scope's insertion point instead of appending.
- A reviewer should check that the decorator path's `appendLeft` cannot land
  inside an expression — the matching regex requires `class Name`, i.e. a
  declaration form, which is why this is safe.
- The scanner `findClassBodyEnd` is now load-bearing for correctness, not just a
  validity check. Any future change to it needs the source-meta unit tests run.
