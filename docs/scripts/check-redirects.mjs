// After `astro build`, every redirect in astro.config.mjs is a meta-refresh
// page under dist/. The links validator only checks a redirect's destination
// when some page still links to the old URL, so this walks each generated
// redirect page and asserts its target exists in dist/. Run via `pnpm run
// build` in docs/; exits non-zero on a dangling redirect.
import {readFile, stat} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const {base, redirects} = await import(resolve(here, '../redirects.mjs'));
let failures = 0;

for (const [from, to] of Object.entries(redirects)) {
  const target = typeof to === 'string' ? to : to.destination;
  const page = join(dist, from, 'index.html');
  let html;
  try {
    html = await readFile(page, 'utf8');
  } catch {
    console.error(
      `[check-redirects] missing redirect page for ${from}: ${page}`
    );
    failures++;
    continue;
  }
  const match = html.match(/content="0;url=([^"]+)"/);
  if (!match) {
    console.error(`[check-redirects] ${page} has no meta refresh`);
    failures++;
    continue;
  }
  const url = decodeURIComponent(match[1]);
  if (url !== target) {
    console.error(
      `[check-redirects] ${from}: refresh points at ${url}, config says ${target}`
    );
    failures++;
    continue;
  }
  const rel = url.startsWith(base) ? url.slice(base.length) : url;
  const dest = join(dist, rel, 'index.html');
  try {
    await stat(dest);
  } catch {
    console.error(`[check-redirects] ${from} -> ${url}: no page at ${dest}`);
    failures++;
  }
}

const count = Object.keys(redirects).length;
if (failures) {
  console.error(`[check-redirects] ${failures} of ${count} redirects broken`);
  process.exit(1);
}
console.log(`[check-redirects] ${count} redirects ok`);
