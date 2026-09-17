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
page`, not `feat: flash updates`. The body explains why the change exists; that
prose is what the changelog is built from, so write it for a reader who wasn't
here.

A commit that should show up in `CHANGELOG.md` carries a trailer, next to
`Co-Authored-By`:

```
Changelog: Added        # or Changed | Fixed | Removed
Changelog: skip         # plan-status bumps, tooling churn, refactors
```

Untrailed commits are left out of the draft entirely, so the trailer is how you
opt in.

Work lands on a branch named for its kind (`feature/`, `fix/`, `docs/`,
`roadmap/NN-slug`, `advisor/NNN-slug`) and merges with `--no-ff`. Release
commits bump `package.json`, write the `CHANGELOG.md` section, and get a
`v<version>` tag.

At release time, draft the section from the commits since the last tag:

```sh
pnpm run changelog                    # heading reads "Unreleased"
pnpm run changelog --tag v0.4.0       # heading reads "0.4.0" (no `--`)
```

That prints to stdout and writes nothing. It groups by the trailers and hands
back each commit's body; edit it into prose and paste it into `CHANGELOG.md` —
the file is hand-written on purpose, and `cliff.toml` explains why.
