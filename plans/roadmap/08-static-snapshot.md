# Plan 08: Export a recorded session as a static panel

## Status

- **Done** (2026-09-17)
- **Effort**: M
- **Risk**: MED — the export writes a directory to the developer's disk, and
  it added a `replay` path through `definition.ts`'s `setup()` that the live
  path also runs
- **Depends on**: 02 (the event buffer this bakes), 07 (interactions that work
  with no node side)

## Why this shape

The roadmap was explicit that the valuable version is **not** "a static copy of
the panel" but "a recorded session someone can attach to an issue". That
distinction decided the whole design.

A static copy is what `lit-devtools build` would have produced: a fresh CLI
process has no page, no timeline and no component tree, so `createBuild()` on a
null-source definition bakes an empty shell. The recording lives in the running
dev server's memory. So the export runs **inside the dev server that holds the
data**, and the CLI's `build` command now says so rather than pretending to be
unimplemented.

This also means capture needed no new transport at all. By the time a developer
wants to export, `definition.ts` is already holding all four things worth
freezing: the timeline ring buffer, the component tree, the details of every
component that was opened, and the HMR incompatibility list. The export reads
its own state.

## How it works

1. **`lit:export-snapshot`** (`definition.ts`) gathers the live caches into a
   `SessionSnapshot` (`src/types/snapshot.ts`) and hands it to
   `buildSnapshot()`.
2. **`src/lib/snapshot.ts`** builds a _second_ definition with `replay` set and
   a null source, and runs devframe's `createBuild()` on it. The build adapter
   is imported dynamically: it reaches for `node:fs`, and `definition.ts` has
   to keep loading in environments that have none.
3. **`replay`** seeds `setup()`'s caches (`cachedRoots`, `cachedDetails`,
   `recentEvents`, `hmrIncompatibilities`) and the session's `customLayers`, so
   the frozen panel's queries answer from the recording.
4. **Baking.** `list-components`, `hmr-incompatibilities` and `recent-events`
   take no required arguments, so `snapshot: true` covers them.
   `component-details` takes an id, so it uses the definition's
   `rpc.snapshot` entries with one input tuple per component the session
   actually opened — the only ids that have details to freeze.

## The frozen panel

Baking the data is necessary but not sufficient: a panel that renders a dead
session while offering buttons that can only fail is not a bug report, it is a
broken app. `isSnapshot()` (`panel/client.ts`) reads the connection's
`backend: 'static'`, and:

- The Components tab stops issuing `inspect` commands. There is no page to
  command, and `inspect` is an `action`, so it is not in the dump at all —
  calling it produced an unhandled rejection in the console.
- The Timeline tab reads `recent-events` once instead of subscribing to the
  stream. This one matters most: a static deploy has no streaming channel, so
  without it the recorded timeline — the entire point — rendered as an empty
  list.
- Record and Export are hidden/disabled.

## Verified

- **`src/test/e2e/snapshot_test.ts`**: a real `createBuild()` into a temp directory,
  then assertions on the emitted dump shards — the tree, the events, the custom
  layer, and a per-id `component-details` shard. Asserting on the dump rather
  than on "a directory appeared" is the difference between testing the feature
  and testing `mkdir`. It sits in the e2e project, not the unit one: it writes
  real files, and `src/test/**` is outside the root tsconfig, so the
  pre-commit hook's per-file type check rejects a `node:fs/promises` import in
  a unit test while accepting it in an e2e one.
- **Manually, end to end**: exported from the playground with a real browser
  attached (8 events, 31 components, 1 details record), then stopped the dev
  server, served the output as plain static files from a bare Node http server,
  and loaded it in Chrome. The component tree renders, **8 timeline event rows
  render**, and the console is clean.

## Known limits

- Only components whose details were opened during the session have details
  baked. Details are collected from live DOM; there is nothing to freeze for a
  component nobody looked at.
- The timeline is capped at the node side's ring buffer
  (`RECENT_EVENTS_BUFFER_SIZE`), so a long session exports its tail.
- The export writes wherever the dev server's cwd resolves `outDir` to, and
  overwrites. It is a deliberate button press, but it is not sandboxed.
- Not agent-exposed, deliberately — it writes to disk, and the same reasoning
  that keeps the other mutating actions out of MCP applies.
