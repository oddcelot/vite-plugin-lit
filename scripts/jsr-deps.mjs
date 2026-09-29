// Rewrites package.json so `jsr publish` can resolve this package's imports:
//
//   node scripts/jsr-deps.mjs && pnpm dlx jsr publish --allow-dirty
//
// JSR turns each bare import into `npm:<name>@<range>`, taking the range
// from `dependencies` or `devDependencies` only. Peer dependencies aren't
// read, and an import it can't map ships as a broken relative path (the
// failed 0.7.0 publish: `Module not found "file:///lib/vite"`). So each peer
// range is copied over the devDependency, which is also what replaces
// `catalog:`. JSR's specifier parser rejects `||` and spaces, and refuses
// `*` as "missing a version constraint", so a `||` range keeps its last
// (newest) alternative: vite's `^7.0.0 || ^8.0.0` becomes `^8.0.0`.
//
// Run it in CI only: it edits package.json in place.

import {readFileSync, writeFileSync} from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
  const newest = range.split('||').at(-1).trim();
  if (/\s/.test(newest)) {
    throw new Error(
      `jsr-deps: no single range JSR accepts in ${name}@${range}`
    );
  }
  pkg.devDependencies[name] = newest;
}
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
