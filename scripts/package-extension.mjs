/**
 * Builds the Chrome extension and zips it for the Web Store:
 *
 *     pnpm run package:extension    # writes dist/lit-inspector-<version>.zip
 *
 * The zip holds what `dist/extension/` holds, with `manifest.json` at its
 * root, minus the source maps: the build keeps them for debugging the
 * unpacked extension, and the store has no use for them. The version is the
 * one the build wrote into the manifest, which is the package's.
 *
 * Uses the `zip` command (preinstalled on macOS and on GitHub's Ubuntu
 * runners); Node has no zip writer of its own.
 */

import {execFileSync} from 'node:child_process';
import {readFile, rm} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist', 'extension');

execFileSync('pnpm', ['run', 'build:extension'], {cwd: ROOT, stdio: 'inherit'});

const {version} = JSON.parse(
  await readFile(path.join(DIST, 'manifest.json'), 'utf8')
);
const zip = path.join(ROOT, 'dist', `lit-inspector-${version}.zip`);
await rm(zip, {force: true});
// -X: no extra file attributes (uid/gid, timestamps beyond the basic one).
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '*.map'], {
  cwd: DIST,
  stdio: 'inherit',
});
execFileSync('unzip', ['-l', zip], {stdio: 'inherit'});
console.log(`\n${path.relative(ROOT, zip)}`);
