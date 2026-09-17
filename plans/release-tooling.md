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
3. `git push origin main --follow-tags`, then `pnpm publish` locally, gated by
   `prepublishOnly` (`vp check` + unit tests + build).

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

## Next step, when release friction justifies it

A GitHub Actions workflow triggered on `v*` tag push that:

- runs the existing gate, then `pnpm publish`, and
- creates the GitHub Release from the matching `CHANGELOG.md` section.

That keeps local merges and hand-written prose while making
`git push --follow-tags` the entire release. Authenticate it with an npm
automation token or npm's OIDC trusted publishing — the 0.3.0 publish stalled
on an expired local token, and CI credentials are the durable fix. Note that
the `v0.3.0` tag is pushed but no GitHub Release object exists for it; the
releases page is empty.
