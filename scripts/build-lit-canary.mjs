#!/usr/bin/env node
// Builds the lit submodule (./lit) from source so `LIT_CANARY=1` test runs
// resolve the lit packages from real source instead of published npm
// versions. Requires the submodule: git submodule update --init
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const litDir = resolve(root, 'lit');

if (!existsSync(resolve(litDir, 'package.json'))) {
  console.error(
    '[canary] lit submodule missing — run: git submodule update --init'
  );
  process.exit(1);
}

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, {cwd: litDir, stdio: 'inherit'});
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!existsSync(resolve(litDir, 'node_modules'))) {
  run('npm', ['ci']);
}

// Full monorepo build (wireit caches inside the submodule, so repeat runs
// only rebuild what changed).
run('npm', ['run', 'build:ts']);
console.log('[canary] lit built — run tests with LIT_CANARY=1');
