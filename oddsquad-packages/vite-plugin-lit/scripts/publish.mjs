#!/usr/bin/env node
import {execSync} from 'node:child_process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');

const type = process.argv[2] || 'patch';

execSync(`npm version ${type}`, {cwd: pkgDir, stdio: 'inherit'});
execSync('npm publish', {cwd: pkgDir, stdio: 'inherit'});
