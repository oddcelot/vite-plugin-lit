/**
 * Builds the extension and zips it for its store:
 *
 *     pnpm run package:extension            # dist/lit-inspector-<version>.zip
 *     pnpm run package:extension --firefox  # dist/lit-inspector-<version>-firefox.zip
 *
 * The zip holds what `dist/extension/` (or `dist/extension-firefox/`) holds,
 * with `manifest.json` at its root, minus the source maps: the build keeps
 * them for debugging the unpacked extension, and the stores have no use for
 * them. The version is the one the build wrote into the manifest, which is
 * the package's.
 *
 * `--firefox` also writes `dist/amo-source-<version>.zip`, the source AMO
 * asks for when an add-on is bundled: the committed tree at HEAD, from
 * `git archive`, which leaves out the `lit` submodule the extension doesn't
 * build from. It refuses a working tree with uncommitted changes, which the
 * reviewers' build could not reproduce. Outside a git checkout, which is
 * how the reviewers get that source, it only builds the zip. The build steps
 * to paste next to it are in `extension/store/listing-firefox.md`.
 *
 * Uses the `zip` command (preinstalled on macOS and on GitHub's Ubuntu
 * runners); Node has no zip writer of its own.
 */

import {execFileSync} from 'node:child_process';
import {readFile, rm} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const firefox = process.argv.includes('--firefox');

let inGit = true;
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
} catch {
  inGit = false;
}
const withSource = firefox && inGit;

if (withSource) {
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('.DS_Store'));
  if (dirty.length > 0) {
    console.error(
      `Uncommitted changes; AMO's source would not match the build:\n${dirty.join('\n')}`
    );
    process.exit(1);
  }
}
const DIST = path.join(
  ROOT,
  'dist',
  firefox ? 'extension-firefox' : 'extension'
);

execFileSync(
  'pnpm',
  ['run', firefox ? 'build:extension:firefox' : 'build:extension'],
  {cwd: ROOT, stdio: 'inherit'}
);

const {version} = JSON.parse(
  await readFile(path.join(DIST, 'manifest.json'), 'utf8')
);
const zip = path.join(
  ROOT,
  'dist',
  `lit-inspector-${version}${firefox ? '-firefox' : ''}.zip`
);
await rm(zip, {force: true});
// -X: no extra file attributes (uid/gid, timestamps beyond the basic one).
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '*.map'], {
  cwd: DIST,
  stdio: 'inherit',
});
execFileSync('unzip', ['-l', zip], {stdio: 'inherit'});
console.log(`\n${path.relative(ROOT, zip)}`);

if (withSource) {
  const source = path.join(ROOT, 'dist', `amo-source-${version}.zip`);
  await rm(source, {force: true});
  execFileSync(
    'git',
    [
      'archive',
      '--format=zip',
      `--prefix=vite-plugin-lit/`,
      '-o',
      source,
      'HEAD',
    ],
    {cwd: ROOT, stdio: 'inherit'}
  );
  console.log(path.relative(ROOT, source));
}
