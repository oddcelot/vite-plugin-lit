# Release tooling

Releases are hand-driven and tag-triggered. Work merges to `main` with
`--no-ff`. A release commit bumps `package.json`, writes the `CHANGELOG.md`
section, and gets a `v<version>` tag. `git push origin main --follow-tags` is
the release: `.github/workflows/release.yaml` runs the gate, publishes to npm,
and creates the GitHub Release. Commit and branch conventions are in
`CLAUDE.md`.

## Changelog

`pnpm run changelog` drafts the section from the commits since the last tag,
grouped by the `Changelog: Added|Changed|Fixed|Removed` trailer (`cliff.toml`,
git-cliff). It prints to stdout and writes nothing. The file itself stays
hand-edited, because the explanatory prose is the reason anyone reads it.

## CI release

- The workflow runs on every `v*` tag push, so a tag push is the whole release
  while local merges and hand-written prose stay as they are.
- It first checks that the tag matches `package.json` and that `CHANGELOG.md`
  has a section for the version (`scripts/release-notes.mjs`). Then it runs the
  CI gate: build, docs sync, `vp check`, `test:unit`.
- It runs `pnpm pack`, then `npm publish` of the tarball over npm trusted
  publishing (OIDC). There is no token to expire, which is what stalled 0.3.0.
  npm does the publish because it handles the OIDC exchange, and pnpm documents
  pack-then-publish as the route since its native `publish` in v11. npm runs
  outside the checkout, because `devEngines` refuses it there.
- A tag containing `-` is a prerelease and goes to the `next` dist-tag.
- A second job creates the GitHub Release from the changelog section.
- `.github/workflows/ci.yaml` runs `check` (build, docs sync, `vp check`, unit
  tests) and `e2e` as separate jobs. If e2e flakes on CI hardware, raise the
  timeout and polls deliberately rather than retrying blindly. The lit-canary
  workflow (`.github/workflows/lit-canary.yaml`) runs the suite against lit
  `main` as early warning that upstream broke in-place patching. Its failures
  need an owner or they become noise.

## Considered and rejected

- **intuit/auto.** It derives the release from labels on merged pull requests.
  This repo has no pull requests: everything lands as a local `--no-ff` merge
  and `main` is the only branch on origin. Without a PR behind a commit, auto
  files it as "pushed to base branch" and defaults to a `patch` bump, which
  would have been wrong for a release that replaced the panel transport. It also
  moves the release-shaping decision from the commit, where the context is, to a
  label in a web UI afterwards. What would make it viable: a second contributor,
  or a move to PRs for review. Its hoisting of a `## Release Notes` PR section
  would suit the existing commit bodies, and per-PR canary releases would help a
  plugin whose bug reports are "HMR broke in my app". Revisit then. Abandoning
  the current setup costs nothing: one config file, one script, one
  devDependency.
- **Changesets.** It coordinates versions across monorepo packages. Here it
  would only duplicate the prose, once in the changeset and once in the commit.
- **Conventional Commits with semantic-release or changelogen.** It would put
  `feat:` and `fix:` on subject lines that carry a full sentence. The trailer
  gives the same machine-readability without that.
