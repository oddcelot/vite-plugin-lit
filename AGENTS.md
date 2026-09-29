<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Commits and the changelog

Subjects are plain sentences in the imperative — `Flash updated elements on the
page`, not `feat: flash updates`. The body explains why the change exists, for a
reader of the git history who wasn't here; the changelog entry is separate,
below.

Every non-merge commit carries a `Changelog:` trailer next to `Co-Authored-By`;
the commit-msg hook refuses one without it. A commit that should show up in
`CHANGELOG.md` folds its user-facing entry under the trailer, on lines indented
by two spaces:

```
Changelog: Fixed        # or Added | Changed | Removed
  **Source links open in the editor you chose.** Clicks from the panel and
  the in-page overlay now pass the editor picked in config, env or Settings.
Changelog: skip         # tests, docs, tooling, refactors, plan-status bumps
```

The entry is one bullet from the user's side: a bold outcome, then the symptom
that is gone or the thing now possible. `/changelog entry` drafts it from the
staged diff. A trailer with nothing folded under it still lands in the draft,
with the body as a placeholder to rewrite.

Work lands on a branch named for its kind (`feature/`, `fix/`, `docs/`) and
merges with `--no-ff`. Release commits bump `package.json`, write the
`CHANGELOG.md` section, and get a `v<version>` tag. Pushing that tag
(`git push origin main --follow-tags`) is the release:
`.github/workflows/release.yaml` runs the gate, publishes to npm over trusted
publishing, and creates the GitHub Release from the changelog section. Don't
`pnpm publish` by hand.

At release time, `/changelog release v0.6.0` assembles the section: it runs
the draft, rewrites any entry that fell back to a commit body, writes the
intro paragraph, inserts the section into `CHANGELOG.md` and bumps
`package.json`, then stops for review. The draft alone is

```sh
pnpm run changelog                    # heading reads "Unreleased"
pnpm run changelog --tag v0.4.0       # heading reads "0.4.0" (no `--`)
```

which prints to stdout and writes nothing. The file is hand-written on
purpose, and `cliff.toml` explains why.

## Working through beads

Tasks live in beads (`bd ready`, `bd show <id>`). When you're handed several
beads, finish them one at a time. Each one gets:

1. A fresh branch off `main`, named for its kind (`feature/<slug>`,
   `fix/<slug>`, …). Claim the bead with `bd update <id> --claim`.
2. Atomic commits: each commit is one self-contained step that passes
   `vp check` and `vp test` by itself (a refactor, then the behaviour built on
   it, then docs), carrying its own body and `Changelog:` trailer.
3. A `--no-ff` merge into `main` once checks pass, then deleting the branch
   and running `bd close <id>`. Start the next bead from the updated `main`.

Anything you find along the way that's out of scope becomes a new bead
(`bd create`), not an extra commit.
