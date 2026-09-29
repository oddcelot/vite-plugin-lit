// Prepares the root CHANGELOG.md for starlight-changelogs, which renders the
// version list and a page per release (src/content.config.ts). Its Keep a
// Changelog provider reads a release date only from a `## X.Y.Z - YYYY-MM-DD`
// heading, while our headings use an em dash, which scripts/release-notes.mjs
// and the release workflow match on. So this writes a copy with the dash
// swapped instead of changing the convention. The copy is gitignored; the
// root file stays the single source of truth.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../CHANGELOG.md');
const target = resolve(here, '../.generated/CHANGELOG.md');

const raw = await readFile(source, 'utf8');
const body = raw.replace(
  /^(## \S+) — (\d{4}-\d{2}-\d{2})$/gm,
  (_, version, date) => `${version} - ${date}`
);

await mkdir(dirname(target), {recursive: true});
await writeFile(target, body);
console.log(`[sync-changelog] wrote ${target}`);
