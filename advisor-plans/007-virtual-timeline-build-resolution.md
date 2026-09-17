# Plan 007: Make `virtual:lit-plugin/timeline` resolve during `vite build`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 2889243..HEAD -- src/lib/plugin.ts docs/src/content/docs/guides/devtools-timeline/custom-layers.mdx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (adds a build-time resolution path; the dev path is unchanged)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2889243`, 2026-09-17
- **Found by**: the `plans/roadmap/04-typed-timeline-api.md` planning pass,
  then reproduced empirically (see below)

## Why this matters

`virtual:lit-plugin/timeline` is documented as a supported extension point for
app code and other plugins, and the docs explicitly promise it is safe to leave
in a production build:

`docs/src/content/docs/guides/devtools-timeline/custom-layers.mdx:33`:

```
The virtual module resolves to a no-op stub in production and when `timeline`
```

It does not. A production build fails outright.

The `load` hook was written with exactly this promise in mind —
`src/lib/plugin.ts:771-772` carries the comment "otherwise a no-op stub so
imports don't throw in prod builds" — but both the `resolveId` and `load` hooks
live on the `hmr` plugin, which is declared `apply: 'serve'`
(`src/lib/plugin.ts:727-729`). Vite skips every hook of a `serve`-only plugin
during `vite build`, so nothing claims the specifier, and the bundler fails to
resolve it.

The consequence is the worst shape a bug can take: a developer follows the
documented guide, everything works all through development, and the build
breaks at the end with an error that names a module they never wrote and cannot
find in their source tree.

### Reproduction (confirmed at `2889243`)

```sh
mkdir -p .e2e-tmp/vmod-repro
cat > .e2e-tmp/vmod-repro/main.ts <<'EOF'
import {addTimelineEvent} from 'virtual:lit-plugin/timeline';
addTimelineEvent({layerId: 'x', time: 0, data: {}});
EOF
cat > .e2e-tmp/vmod-repro/index.html <<'EOF'
<!doctype html><html><body><script type="module" src="./main.ts"></script></body></html>
EOF
cat > .e2e-tmp/vmod-repro/vite.config.ts <<'EOF'
import {defineConfig} from 'vite-plus';
import {litPlugin} from '../../index.js';
export default defineConfig({plugins: [litPlugin({timeline: true})]});
EOF
pnpm exec vp build .e2e-tmp/vmod-repro
```

Observed:

```
error during build:
Build failed with 1 error:

Error: [vite+]: Rolldown failed to resolve import "virtual:lit-plugin/timeline"
from ".../.e2e-tmp/vmod-repro/main.ts".
```

Note it reproduces with `timeline: true`. The `timeline: false` case fails
identically, because the gate that matters is `apply: 'serve'`, not the option.

## Current state

File: `src/lib/plugin.ts`.

The plugin that owns both hooks, `src/lib/plugin.ts:727-729`:

```ts
  const hmr: Plugin = {
    name: 'lit-plugin',
    apply: 'serve',
```

`resolveId`, `src/lib/plugin.ts:742-746`:

```ts
    resolveId(id) {
      // Public timeline API virtual module.
      if (id === 'virtual:lit-plugin/timeline') {
        return '\0virtual:lit-plugin/timeline';
      }
```

`load`, `src/lib/plugin.ts:770-787` — note the stub branch and its comment:

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

There is prior art in this file for exactly this split. `optionsPlugin` exists
because env resolution is needed at build time too, and its comment
(`src/lib/plugin.ts:630-633`) says so:

```ts
// Env resolution lives in its own always-applied plugin: `?css-sheet` is a
// build-time feature too, and the HMR plugin (`apply: 'serve'`) never gets a
// `config` hook under `vite build`. `enforce: 'pre'` and first position put
// it ahead of every other hook that reads `resolved`.
```

`litCssQueries()` follows the same pattern for the CSS import queries. This bug
is the timeline virtual module having been left behind in the serve-only
plugin when that pattern was established.

## Implementation

1. Add a new always-applied plugin in `litPlugin()` — suggested name
   `litTimelineVirtual` — that owns `resolveId` and `load` for
   `virtual:lit-plugin/timeline` only. Follow `litCssQueries()` for shape and
   placement. Do **not** give it `apply`.
2. Move the `resolveId` branch at `src/lib/plugin.ts:742-746` and the `load`
   branch at `:770-787` into it, unchanged. Leave every other branch of both
   hooks on the `hmr` plugin.
3. Decide what the module resolves to under `vite build`. The dev behavior must
   not change. Under build, the runtime module is dev-only (it talks over
   `import.meta.hot`), so the build path must return the no-op stub
   **regardless of `resolved.timeline`**. Read `src/lib/runtime/timeline/public-api.ts`
   and confirm this before implementing; if it turns out to be build-safe,
   record why in a comment rather than silently keeping the re-export.
   The hook receives the command via the plugin's `config`/`configResolved`
   hook or `this.environment`; pick whichever this Vite version supports
   cleanly and note the choice.
4. Register the new plugin in the array at `src/lib/plugin.ts:894-902`,
   alongside `litCssQueries()`.
5. Add a unit test asserting both paths: `resolveId` claims the specifier, and
   `load` returns the stub under build and the re-export under serve with
   `timeline: true`. `src/test/unit/transform_test.ts` already reaches into
   `litPlugin()`'s returned array to exercise hooks — follow its pattern.
6. Add an e2e or build-level test that runs a real `vite build` over a fixture
   importing the virtual module and asserts it succeeds. The reproduction above
   is the fixture; `src/test/e2e/css-sheet-build_test.ts` is the closest
   existing example of a build-mode test.
7. Re-read `docs/src/content/docs/guides/devtools-timeline/custom-layers.mdx:33`
   and `docs/src/content/docs/reference/runtime-api.mdx` and make the wording
   match the implemented behavior.

## Verification

```sh
pnpm exec vp check
pnpm run build
pnpm exec vp test run --project unit
```

Then the reproduction from the top of this plan must build cleanly, and the
emitted chunk must contain the no-op stub rather than a reference to the
runtime module:

```sh
pnpm exec vp build .e2e-tmp/vmod-repro && grep -r "addTimelineEvent" .e2e-tmp/vmod-repro/dist/assets/
```

Finally, confirm dev is unchanged: `pnpm dev`, open the playground, and verify
a custom layer still appears in the Timeline panel (see
`docs/.../devtools-timeline/custom-layers.mdx` for a snippet to paste).

## STOP conditions

- If moving the hooks off `apply: 'serve'` changes behavior for any specifier
  other than `virtual:lit-plugin/timeline` — stop. The other branches of
  `resolveId`/`load` are serve-only on purpose.
- If the stub-under-build decision in step 3 turns out to change what a
  `timeline: true` production build emits in a way that is not a pure no-op,
  stop and report before proceeding.
- If `pnpm run build` or the unit suite fails for a reason you cannot tie to
  this change, stop — the working tree may have drifted from `2889243`.

## Related

- `plans/roadmap/04-typed-timeline-api.md` adds the ambient TypeScript
  declaration for this same module. The two are independent: 04 fixes
  `TS2307` at author time, this plan fixes the build. Doing 04 without this one
  makes the module easier to adopt and therefore makes this bug easier to hit,
  so prefer landing this first.
