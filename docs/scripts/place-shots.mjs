// One-off helper for the docs overhaul: replaces `{/* shot: <name> */}`
// placeholder comments in MDX pages with a <ThemedImage> whose light/dark PNGs
// exist under src/assets/shots/. Placeholders whose images are missing are left
// in place and listed, so a page never references an image that is not there.
// Safe to rerun; it skips pages that already import a given shot.
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, '../src/content/docs');
const shotsDir = resolve(here, '../src/assets/shots');
const componentPath = resolve(here, '../src/components/ThemedImage.astro');

// Alt text says what to notice, per STYLE.md.
const ALT = {
  'indicator-idle':
    'The HMR indicator at rest in the corner of the page: a flame icon, a dot and a zero.',
  'indicator-green':
    'The indicator pulsing green after a component edit; the count reads 1.',
  'indicator-cyan':
    'The indicator pulsing cyan after a stylesheet swap; the count has not moved.',
  'hmr-indicator-green':
    'The indicator pulsing green after a component edit; the count reads 1.',
  'hmr-indicator-cyan':
    'The indicator pulsing cyan after a stylesheet swap; the count has not moved.',
  'css-sheet-cyan-pulse':
    'The indicator pulsing cyan after a shared stylesheet edit, with the count unchanged.',
  'tutorial-indicator-idle':
    'The indicator at rest in the corner of the page, showing 0.',
  'tutorial-green-pulse':
    'The indicator pulsing green after the label edit; the count reads 1.',
  'tutorial-state-survives':
    'The notes component after a header edit: both notes, the count and the half-typed input are still there.',
  'tutorial-cyan-pulse':
    'The indicator pulsing cyan after the theme.css edit; the count has not moved.',
  'source-overlay-armed':
    'The source overlay outlining a component, with a tooltip showing its tag name and source file.',
  'devtools-panel-docked':
    'The Lit panel docked inside Vite DevTools, showing the Components tab.',
  'devtools-settings-tab':
    'The Settings tab listing the resolved options with live overrides and a Reset to env button.',
  'devtools-timeline-collapsed':
    'The Timeline tab with collapsed lifecycle rows for hmr-counter, each showing its duration.',
  'devtools-timeline-raw':
    'The Timeline tab with Raw on: one row per recorded event, including custom Router events.',
  'devtools-timeline-row-details':
    'A timeline row expanded to show the element, instance id, changed properties and source link.',
  'devtools-export-snapshot':
    'An exported snapshot opened as a static page: the same timeline, read-only.',
  'devtools-components-tree':
    'The Components tab: the element tree on the left, hmr-properties selected, its reactive properties on the right.',
  'devtools-flash':
    'The playground with flash on: fading outlines over the components that just updated.',
  'devtools-updates-table':
    'The Updates tab table: one row per component with update counts and total time.',
  'devtools-updates-detail':
    'One update expanded in the Updates tab, showing the changed property keys and the triggering input event.',
  'devtools-custom-layer':
    'Timeline rows from a custom Router layer, in the layer colour, next to Lit lifecycle rows.',
  'landing-panel-docked':
    'A Lit app with the DevTools panel docked below it and the HMR indicator in the corner.',
};

const walk = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.name.endsWith('.mdx')) out.push(p);
  }
  return out;
};

// Slot names that reuse an existing capture.
const ALIAS = {
  'hmr-indicator-green': 'indicator-green',
  'hmr-indicator-cyan': 'indicator-cyan',
  'css-sheet-cyan-pulse': 'indicator-cyan',
  'tutorial-indicator-idle': 'indicator-idle',
  'tutorial-green-pulse': 'indicator-green',
  'tutorial-cyan-pulse': 'indicator-cyan',
  'landing-panel-docked': 'devtools-panel-docked',
};

const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const missing = [];
let placed = 0;

for (const file of await walk(docsRoot)) {
  let src = await readFile(file, 'utf8');
  const slots = [...src.matchAll(/\{\/\* shot: ([a-z0-9-]+) \*\/\}/g)].map(
    (m) => m[1]
  );
  if (slots.length === 0) continue;

  const fileDir = dirname(file);
  const relShots = relative(fileDir, shotsDir).split('\\').join('/');
  const relComponent = relative(fileDir, componentPath).split('\\').join('/');
  const imports = [];
  let needsComponent = !src.includes('ThemedImage.astro');
  let placedHere = 0;

  for (const name of new Set(slots)) {
    const file = ALIAS[name] ?? name;
    const light = join(shotsDir, `${file}.light.png`);
    const dark = join(shotsDir, `${file}.dark.png`);
    const have = await Promise.all(
      [light, dark].map((p) =>
        readFile(p).then(
          () => true,
          () => false
        )
      )
    );
    if (!have[0] || !have[1]) {
      missing.push(`${relative(docsRoot, file)}: ${name}`);
      continue;
    }
    const id = camel(file);
    if (
      !src.includes(`import ${id}Light `) &&
      !imports.some((l) => l.includes(`import ${id}Light `))
    ) {
      imports.push(`import ${id}Light from '${relShots}/${file}.light.png';`);
      imports.push(`import ${id}Dark from '${relShots}/${file}.dark.png';`);
    }
    const alt = ALT[name] ?? `Screenshot: ${name}`;
    const tag = `<ThemedImage light={${id}Light} dark={${id}Dark} alt="${alt.replace(/"/g, '&quot;')}" />`;
    src = src.split(`{/* shot: ${name} */}`).join(tag);
    placed++;
    placedHere++;
  }

  if (placedHere > 0 && (imports.length > 0 || needsComponent)) {
    const lines = [];
    if (needsComponent)
      lines.push(`import ThemedImage from '${relComponent}';`);
    lines.push(...imports);
    // Insert after the import block at the top of the file (imports and
    // blank lines directly under the frontmatter). Scanning the whole file
    // would land inside a code fence that shows an `import` line.
    const fmEnd = src.indexOf('\n---\n', 3) + 5;
    const head = src.slice(fmEnd).split('\n');
    let i = 0;
    let lastImport = -1;
    while (
      i < head.length &&
      (head[i].startsWith('import ') || head[i].trim() === '')
    ) {
      if (head[i].startsWith('import ')) lastImport = i;
      i++;
    }
    if (lastImport >= 0) head.splice(lastImport + 1, 0, ...lines);
    else head.unshift(...lines, '');
    src = src.slice(0, fmEnd) + head.join('\n');
  }
  await writeFile(file, src);
}

console.log(`[place-shots] placed ${placed} image(s)`);
if (missing.length) {
  console.log(
    `[place-shots] ${missing.length} placeholder(s) left in place (no PNG yet):`
  );
  for (const m of missing) console.log('  ' + m);
}
