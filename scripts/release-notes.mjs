/**
 * @license
 * Copyright 2026 Oddsquad
 * SPDX-License-Identifier: BSD-3-Clause
 */

// Prints one version's section of CHANGELOG.md, without its heading, for use
// as GitHub Release notes:
//
//   node scripts/release-notes.mjs 0.3.0 > notes.md
//
// Exits non-zero when the section is missing or empty, so a release can't go
// out with the changelog entry forgotten.

import {readFileSync} from 'node:fs';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const lines = readFileSync(
  new URL('../CHANGELOG.md', import.meta.url),
  'utf8'
).split('\n');
// Headings read `## 0.3.0 — 2026-09-17`.
const start = lines.findIndex(
  (line) => line === `## ${version}` || line.startsWith(`## ${version} `)
);
if (start === -1) {
  console.error(`[release-notes] no "## ${version}" section in CHANGELOG.md`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
if (end === -1) end = lines.length;

const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim();
if (body === '') {
  console.error(`[release-notes] the ${version} section is empty`);
  process.exit(1);
}
process.stdout.write(body + '\n');
