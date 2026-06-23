#!/usr/bin/env node
// Copies the DevTools panel's index.html into the build output. `tsc` emits the
// panel's .ts -> panel/*.js but doesn't copy static assets, and the runtime
// (lib/timeline-plugin.js) resolves the panel from `../panel/index.html`.
import {copyFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');
const src = resolve(
  pkgDir,
  '../../packages/labs/vite-plugin-lit/src/panel/index.html'
);
const destDir = resolve(pkgDir, 'panel');

mkdirSync(destDir, {recursive: true});
copyFileSync(src, resolve(destDir, 'index.html'));
console.log('[@oddsquad/vite-plugin-lit] copied panel/index.html');
