#!/usr/bin/env node
import {execSync} from 'node:child_process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');

const type = process.argv[2] || 'patch';

// `--no-git-tag-version`: this package lives inside the Lit monorepo, so a
// default `npm version` would create a stray commit + tag on that repo. Bump
// package.json only; commit the version deliberately. `npm publish` then runs
// `prepublishOnly` (tsc + panel copy) before packing.
execSync(`npm version ${type} --no-git-tag-version`, {
  cwd: pkgDir,
  stdio: 'inherit',
});
execSync('npm publish', {cwd: pkgDir, stdio: 'inherit'});
