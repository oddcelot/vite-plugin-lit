# Release tooling — what we run, and what we deliberately don't

Status: **decided** (2026-09-18, after the 0.3.0 release)
Author: release pass on `main` @ `b26e07c`

---

## Where it stands

Releases are hand-driven and land in this order:

1. Work merges to `main` with `--no-ff` from a branch named for its kind
   (`feature/`, `fix/`, `docs/`, `roadmap/NN-slug`, `advisor/NNN-slug`).
2. A release commit bumps `package.json`, writes the `CHANGELOG.md` section,
   and gets a `v<version>` tag.
3. `git push origin main --follow-tags`. The tag triggers
   `.github/workflows/release.yaml` (see "CI releases" below).

`pnpm run changelog` drafts step 2 from the commits since the last tag,
grouped by a `Changelog: Added|Changed|Fixed|Removed` trailer in the commit
body (`cliff.toml`, git-cliff). The draft goes to stdout; the file stays
hand-edited, because the explanatory prose is the reason anyone reads it.
Commit and branch conventions are in `CLAUDE.md`.

## Considered and rejected: intuit/auto

[`auto`](https://intuit.github.io/auto/) automates the entire release from
**labels on merged pull requests** — `auto shipit` in CI derives the semver
bump from `major`/`minor`/`patch`/`skip-release` labels, writes the changelog,
tags, creates the GitHub Release, and publishes to npm. It also does canary
releases per PR and `next` prereleases.

Evaluated 2026-09-18 against auto's current docs. **Rejected for now**, for one
reason that is not about changelogs:

- **This repo has no pull requests.** `gh api .../pulls` returns zero, ever.
  Everything lands as a local `--no-ff` merge to `main`, and `main` is the only
  branch on origin. Adopting auto means adopting a PR workflow — that is the
  real decision, and the changelog is a side effect of it.
- With no PR behind a commit, auto files it under a "pushed to base branch"
  heading and falls back to a **default `patch` bump**. For 0.3.0, which
  replaced the panel transport wholesale, that is the wrong version.
- The release-shaping decision moves from the commit (where the context is)
  to a label in a web UI after the fact.
- Solo-maintainer overhead: push branch, open PR, label, wait, merge — per
  change. Plus `GH_TOKEN`/`NPM_TOKEN` secrets and a `skip ci` guard so auto's
  own version commit doesn't retrigger the workflow.

Worth recording what would make it viable, because it isn't a bad tool:

- auto hoists a `## Release Notes` section out of the PR body into the
  changelog. The commit bodies here are already written that way, so the prose
  would survive the switch.
- Canary releases per PR are genuinely useful for a plugin whose bug reports
  are "HMR broke in my app" — you can hand someone a `0.4.0-canary.x`.

**Revisit when** a second contributor appears, or the workflow moves to PRs
for review reasons. Until then the current setup costs nothing to abandon: one
config file, one script, one devDependency, no rewritten history.

Also considered: **Changesets** (built to coordinate versions across packages
in a monorepo; here it only duplicates prose — once in the changeset file, once
in the commit) and **Conventional Commits** with semantic-release or
changelogen (would put `feat:`/`fix:` on subject lines that currently carry a
full sentence; the trailer buys the same machine-readability without that).

## CI releases (done 2026-09-29)

`.github/workflows/release.yaml` runs on every `v*` tag push, which makes
`git push --follow-tags` the whole release while keeping local merges and
hand-written prose:

- It checks that the tag matches `package.json`, and that `CHANGELOG.md` has
  a section for the version (`scripts/release-notes.mjs`).
- It runs the CI gate: build, docs sync, `vp check`, `test:unit`.
- `pnpm pack`, then `npm publish` of the tarball over npm trusted publishing
  (OIDC). There is no token to expire, which is what stalled 0.3.0. npm does
  the publish because it handles the OIDC exchange, and pnpm documents
  pack-then-publish as the route since its native `publish` in v11. npm runs
  outside the checkout, because `devEngines` refuses it there.
- Prerelease versions (`-` in the tag) go to the `next` dist-tag.
- A second job creates the GitHub Release from the changelog section.

The `v0.3.0` tag predates this and still has no GitHub Release object. To
backfill it:
`node scripts/release-notes.mjs 0.3.0 > /tmp/n.md && gh release create v0.3.0 --verify-tag --title v0.3.0 --notes-file /tmp/n.md`.
