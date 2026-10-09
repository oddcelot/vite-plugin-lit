/**
 * Prints the metadata `web-ext sign` sends with a new Lit Inspector version
 * on addons.mozilla.org:
 *
 *     node scripts/amo-metadata.mjs v0.16.0 > amo-metadata.json
 *
 * `web-ext` spreads the `version` object into AMO's new-version request
 * (https://addons-server.readthedocs.io/en/latest/topics/api/addons.html),
 * so it carries:
 *
 * - `release_notes`, shown to users on the listing: a line naming the version
 *   and linking its GitHub Release, whose notes are the CHANGELOG.md section.
 *   The section itself covers the Vite plugin too, so it isn't pasted in.
 * - `approval_notes`, for the reviewers only: the "Notes for reviewers" block
 *   in extension/store/listing-firefox.md, which says how to rebuild the
 *   package from the source upload.
 *
 * Exits non-zero when the reviewer notes can't be found, so a submission
 * never goes out without them.
 */

import {readFileSync} from 'node:fs';

const tag = process.argv[2];
if (!tag || !/^v\d/.test(tag)) {
  console.error('usage: node scripts/amo-metadata.mjs <tag, e.g. v0.16.0>');
  process.exit(1);
}

const listing = readFileSync(
  new URL('../extension/store/listing-firefox.md', import.meta.url),
  'utf8'
);
// The first ```text block after the "## Notes for reviewers" heading.
const notes =
  /^## Notes for reviewers\n[\s\S]*?^```text\n([\s\S]*?)^```$/m.exec(
    listing
  )?.[1];
if (!notes?.trim()) {
  console.error(
    '[amo-metadata] no ```text block under "## Notes for reviewers" in extension/store/listing-firefox.md'
  );
  process.exit(1);
}

const metadata = {
  version: {
    release_notes: {
      'en-US': `Lit Inspector ${tag.slice(1)}. What changed: https://github.com/oddcelot/vite-plugin-lit/releases/tag/${tag}`,
    },
    approval_notes: notes.trim(),
  },
};
process.stdout.write(JSON.stringify(metadata, null, 2) + '\n');
