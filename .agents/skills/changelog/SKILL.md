---
name: changelog
description: Draft the user-facing changelog entry for a commit, or assemble the CHANGELOG.md section for a release from the commits since the last tag. Use at commit time (`/changelog entry`) and at release time (`/changelog release v0.6.0`).
---

# Changelog

`CHANGELOG.md` is hand-written prose. Each commit carries its own entry,
folded under the `Changelog:` trailer, and `pnpm run changelog` assembles
those entries into a draft section. This skill writes the entry at commit time
and turns the draft into the committed section at release time.

## `/changelog entry`

Draft the trailer for the change that is staged (or, if nothing is staged, the
working tree). Read the diff, not the commit body: the body says why the code
changed, the entry says what a user of the plugin gets.

Output exactly this block, ready to paste at the end of the commit message
above `Co-Authored-By`:

```
Changelog: Fixed
  **Source links open in the editor you chose.** Clicks from the panel and
  the in-page overlay now pass the editor picked in config, env or Settings,
  so picking Cursor no longer opens VS Code.
```

Rules for the entry:

- One bullet, one to three sentences, wrapped at 79 columns, every
  continuation line indented two spaces. The indent is what makes git fold it
  into the trailer.
- Starts with a bold phrase naming the outcome from the user's side
  (`**A reloaded live panel keeps the recorded events.**`), not the
  implementation (`**Replay buffer into panel on connect**`).
- Then the symptom that is gone or the thing that is now possible. Name the
  option, env var or UI control the user touches, in backticks.
- Group: `Added` for a new capability, `Changed` for different behaviour of an
  existing one, `Fixed` for a bug, `Removed` for something gone. `skip` with
  nothing folded under it for tests, docs, tooling and refactors. When in
  doubt between Changed and Fixed: was the old behaviour ever intended? Fixed
  if not.
- Match the voice of the existing entries in `CHANGELOG.md`.

## `/changelog release vX.Y.Z`

Assemble and write the section for a release. Nothing here tags or pushes;
that stays with the person.

1. `pnpm run changelog --tag vX.Y.Z` prints the draft. Bullets marked
   `<!-- no entry under the trailer; drafted from the body -->` are commits
   that only carried a group. Rewrite each from its diff (`git show <hash>`)
   using the rules above, and drop the comment.
2. Merge bullets that describe one user-facing change from several commits.
   Keep the order within a group: bigger things first.
3. Write the intro paragraph: two to four sentences saying what this release
   is about, in the voice of the existing sections. Read the last two intros
   first.
4. Insert the section below the preamble of `CHANGELOG.md`, above the
   previous release. The heading must read `## X.Y.Z — YYYY-MM-DD` with an em
   dash; `scripts/release-notes.mjs` finds the section by that heading and
   the release workflow fails without it.
5. Bump `version` in `package.json`.
6. Show the resulting diff and stop. The release commit itself is described in
   AGENTS.md ("Commits and the changelog"); its subject is `Release X.Y.Z`,
   its body a two-sentence summary ending in "See CHANGELOG.md for the full
   section.", and its trailer `Changelog: skip`.

If the draft is empty, say so and stop: either HEAD is already tagged or every
commit since the tag was `skip`.
