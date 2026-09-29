// Rewrites package.json so `jsr publish` can resolve this package's imports:
//
//   node scripts/jsr-deps.mjs && pnpm dlx jsr publish --allow-dirty
//
// JSR turns each bare import into `npm:<name>@<range>`, taking the range
// from `dependencies` or `devDependencies` only. Peer dependencies aren't
// read, and an import it can't map ships as a broken relative path (the
// failed 0.7.0 publish: `Module not found "file:///lib/vite"`). So each peer
// range is copied over the devDependency, which is also what replaces
// `catalog:`. JSR's specifier parser rejects `||` and spaces, so such a
// range becomes `*`, which lets npm reuse whatever version the app has.
//
// Run it in CI only: it edits package.json in place.

import {readFileSync, writeFileSync} from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
  pkg.devDependencies[name] = /\|\||\s/.test(range) ? '*' : range;
}
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
