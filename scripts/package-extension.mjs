/**
 * Builds the extension and zips it for its store:
 *
 *     pnpm run package:extension            # dist/lit-inspector-<version>.zip
 *     pnpm run package:extension --firefox  # dist/lit-inspector-<version>-firefox.zip
 *     pnpm run package:extension --key ~/.config/lit-inspector/crx.pem
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
 * For Chrome it also writes `dist/lit-inspector-<version>.crx`, the zip signed
 * with the CRX key, when it has one: the PEM file `--key` names, or the PEM
 * text in `CWS_CRX_KEY` (how the release workflow passes it). The Web Store
 * accepts only that signed file since the item opted in to verified CRX
 * uploads. Without a key it writes the zip alone, as before. The CRX is read
 * back and checked before the script reports it, with the extension id the
 * key gives it.
 *
 * Uses the `zip` command (preinstalled on macOS and on GitHub's Ubuntu
 * runners); Node has no zip writer of its own.
 */

import {execFileSync} from 'node:child_process';
import {readFile, rm, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packCrx3, readCrx3} from './crx3.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const firefox = process.argv.includes('--firefox');
const keyArg = process.argv.indexOf('--key');
const keyFile = keyArg === -1 ? undefined : process.argv[keyArg + 1];
if (keyArg !== -1 && !keyFile) {
  console.error('--key needs the path of the CRX private key (PEM)');
  process.exit(1);
}
// Read before the build, so a wrong path fails fast.
const crxKey = firefox
  ? undefined
  : keyFile
    ? await readFile(keyFile, 'utf8')
    : process.env.CWS_CRX_KEY || undefined;

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

if (crxKey) {
  const crxPath = zip.replace(/\.zip$/, '.crx');
  const {crx} = packCrx3(await readFile(zip), crxKey);
  await writeFile(crxPath, crx);
  const {id} = readCrx3(await readFile(crxPath));
  console.log(`${path.relative(ROOT, crxPath)} (signed, extension id ${id})`);
} else if (!firefox) {
  console.log('No CRX key (--key or CWS_CRX_KEY): zip only, no signed .crx.');
}

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
