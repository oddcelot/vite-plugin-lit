/**
 * Images for the Chrome extension and its Web Store listing, rendered with
 * Playwright's Chromium.
 *
 *     node scripts/extension-assets.mjs            # icons, then store images
 *     node scripts/extension-assets.mjs icons      # extension/public/icons/
 *     node scripts/extension-assets.mjs store      # extension/store/*.png
 *     node scripts/extension-assets.mjs store --build   # rebuild first
 *
 * `icons` renders the mark (`extension/public/icon.svg`) to the PNGs the
 * manifest lists. The 128px icon is the store icon too: 96px of artwork with 16px of
 * transparent padding on each side, as the store asks.
 *
 * `store` shoots the real extension: the unpacked build (`dist/extension`)
 * on a production build of the Fernhouse example (`examples/fernhouse/dist`),
 * served by `vite preview` with no plugin and no injected runtime. It is the
 * shop the promo video shows, and its sourcemaps give the details pane a
 * defined link. As in the extension
 * e2e, a copy of the build lists the served origin under `host_permissions`,
 * standing in for the permission prompt, and the Lit tab (`panel.html`) is
 * opened in a tab of its own with `?tabId=`. Each screenshot puts the page
 * and the panel side by side, full bleed, the way DevTools docks to the
 * right. The promo tiles are the mark and the name, nothing else.
 *
 * `--build` runs `pnpm run build`, `pnpm run build:extension` and the
 * Fernhouse build first; without it, the last builds are used.
 *
 * Sizes and file names are in `ICONS`, `STORE_ICON`, `SCREENSHOT` and
 * `TILES` below; change them there if the store's requirements change.
 */

import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {preview} from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTENSION = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist', 'extension');
const APP = path.join(ROOT, 'examples', 'fernhouse');
const STORE = path.join(EXTENSION, 'store');
const FONTS = path.join(ROOT, 'assets', 'promo-video', 'assets');

/** Manifest icons: size, and the SVG drawn for it. */
const ICONS = [
  {size: 16, svg: path.join(EXTENSION, 'public', 'icon.svg')},
  {size: 32, svg: path.join(EXTENSION, 'public', 'icon.svg')},
  {size: 48, svg: path.join(EXTENSION, 'public', 'icon.svg')},
  // The store icon: artwork inset by `padding` on every side.
  {size: 128, svg: path.join(EXTENSION, 'public', 'icon.svg'), padding: 16},
];
const STORE_ICON = {from: 'icon-128.png', to: 'icon-128.png'};
const SCREENSHOT = {width: 1280, height: 800, pageWidth: 560};
const TILES = [
  {name: 'promo-small-440x280.png', width: 440, height: 280},
  {name: 'promo-marquee-1400x560.png', width: 1400, height: 560},
];

/** Brand values (the lit-design tokens), dark DevTools theme. */
const BRAND = {
  void: 'hsl(0 0% 1%)',
  surface: 'hsl(0 0% 7%)',
  border: 'hsl(0 0% 21%)',
  text: 'hsl(0 0% 100%)',
  blue: '#324fff',
  cyan: '#00e8ff',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dataUrl = (mime, data) =>
  `data:${mime};base64,${Buffer.from(data).toString('base64')}`;

/* ------------------------------------------------------------------ icons */

const renderIcons = async (browser) => {
  const out = path.join(EXTENSION, 'public', 'icons');
  await mkdir(out, {recursive: true});
  const page = await browser.newPage();
  for (const {size, svg, padding = 0} of ICONS) {
    await page.setViewportSize({width: size, height: size});
    const src = dataUrl('image/svg+xml', await readFile(svg));
    const art = size - 2 * padding;
    await page.setContent(
      `<body style="margin:0;background:transparent">` +
        `<img src="${src}" width="${art}" height="${art}" style="display:block;margin:${padding}px"></body>`
    );
    await page.locator('img').evaluate((img) => img.decode());
    const file = path.join(out, `icon-${size}.png`);
    await page.screenshot({path: file, omitBackground: true});
    console.log(`  ${path.relative(ROOT, file)}`);
  }
  await page.close();
  await mkdir(STORE, {recursive: true});
  await cp(path.join(out, STORE_ICON.from), path.join(STORE, STORE_ICON.to));
  console.log(`  ${path.relative(ROOT, path.join(STORE, STORE_ICON.to))}`);
};

/* ------------------------------------------------------------ store shots */

const fontFaces = async () => {
  const face = async (file, weight) =>
    `@font-face{font-family:Manrope;font-weight:${weight};src:url(${dataUrl(
      'font/woff2',
      await readFile(path.join(FONTS, file))
    )}) format('woff2')}`;
  return (
    (await face('manrope-semibold.woff2', 600)) +
    (await face('manrope-extrabold.woff2', 800))
  );
};

/** The page on the left, the Lit tab on the right, one hairline between. */
const composeScreenshot = async (browser, {page, panel}, file) => {
  const {width, height, pageWidth} = SCREENSHOT;
  const frame = await browser.newPage({viewport: {width, height}});
  await frame.setContent(`<!doctype html><body style="margin:0;display:flex;
    width:${width}px;height:${height}px;overflow:hidden;background:${BRAND.void}">
    <img src="${dataUrl('image/png', page)}" style="width:${pageWidth}px;height:${height}px">
    <div style="width:1px;background:${BRAND.border}"></div>
    <img src="${dataUrl('image/png', panel)}" style="width:${width - pageWidth - 1}px;height:${height}px">
  </body>`);
  for (const img of await frame.locator('img').all()) {
    await img.evaluate((el) => el.decode());
  }
  await frame.screenshot({path: file});
  await frame.close();
  console.log(`  ${path.relative(ROOT, file)}`);
};

const renderTile = async (browser, {name, width, height}) => {
  const mark = dataUrl(
    'image/svg+xml',
    await readFile(path.join(EXTENSION, 'public', 'icon.svg'))
  );
  // Sized from the height, unless the width is the tighter fit, so the pair
  // keeps a margin on a narrow tile.
  const markSize = Math.round(Math.min(height * 0.36, width * 0.21));
  const type = Math.round(Math.min(height * 0.17, width * 0.075));
  const page = await browser.newPage({viewport: {width, height}});
  await page.setContent(`<!doctype html><style>${await fontFaces()}
    body{margin:0;width:${width}px;height:${height}px;display:flex;
      align-items:center;justify-content:center;gap:${Math.round(markSize * 0.3)}px;
      background:radial-gradient(ellipse at 50% 60%, hsl(232 100% 65% / 0.22), transparent 65%), ${BRAND.void};
      font-family:Manrope,sans-serif;color:${BRAND.text}}
    h1{margin:0;font-weight:800;font-size:${type}px;letter-spacing:-0.02em;line-height:1}
    </style><img src="${mark}" width="${markSize}" height="${markSize}"><h1>Lit Inspector</h1>`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(STORE, name);
  await page.screenshot({path: file});
  await page.close();
  console.log(`  ${path.relative(ROOT, file)}`);
};

/** Shops a little, so the panel has updates to show. */
const exercise = async (app) => {
  const cards = app.locator('fh-product-card');
  await cards.nth(1).locator('button.cta').click();
  await app.locator('fh-reviews button').click();
  await sleep(500);
  await cards.nth(2).locator('button.cta').click();
};

/** Records a short session on the panel's Timeline tab, then stops. */
const record = async (app, panel) => {
  const button = panel.locator('timeline-view wa-button.record');
  await button.waitFor();
  // Off by default; the cause rails start from the click and the cart event.
  const chips = panel.locator('timeline-layers .chip');
  for (const name of ['Mouse', 'Custom events']) {
    const chip = chips.filter({hasText: name});
    if (!(await chip.evaluate((c) => c.classList.contains('on')))) {
      await chip.click();
    }
  }
  await button.click();
  await sleep(300);
  await exercise(app);
  await sleep(500);
  await button.click();
  await panel
    .locator('timeline-view timeline-event-list .row')
    .first()
    .waitFor();
  return panel;
};

/** A point on a product card's text, below the picture: picking the
 *  picture selects `<fh-app>`, which renders it into the card's slot. */
const cardText = async (app, index) => {
  const card = app.locator('fh-product-card').nth(index);
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  return {x: box.x + box.width / 2, y: box.y + box.height - 70};
};

const SHOTS = [
  {
    name: 'screenshot-1-components.png',
    async capture({app, openPanel}) {
      const panel = await openPanel('components');
      const rows = panel.locator('components-view .row');
      await rows.first().waitFor({timeout: 15_000});
      // The tree opens on a collapsed <fh-app>; the right arrow unfolds it.
      await rows.first().click();
      await panel.keyboard.press('ArrowRight');
      // The second card, the Fiddle Leaf Fig, holds the reviews task.
      await app.locator('fh-product-card').nth(1).scrollIntoViewIfNeeded();
      await rows.filter({hasText: 'fh-product-card'}).nth(1).click();
      await panel.locator('components-view .details h2').waitFor();
      // Off the tree, so its hover highlight leaves the page.
      await panel.mouse.move(0, 0);
      await sleep(800);
      return {app, panel};
    },
  },
  {
    name: 'screenshot-2-pick.png',
    async capture({app, openPanel}) {
      const panel = await openPanel('components');
      await panel.locator('components-view .row').first().waitFor();
      await panel.locator('components-view wa-button.pick').click();
      await sleep(300);
      const {x, y} = await cardText(app, 0);
      await app.mouse.move(x, y);
      await sleep(200);
      await app.mouse.move(x + 2, y);
      await sleep(700);
      return {app, panel};
    },
  },
  {
    name: 'screenshot-3-timeline.png',
    async capture({app, openPanel}) {
      const panel = await record(app, await openPanel('timeline'));
      const rows = panel.locator('timeline-view timeline-event-list .row');
      const update = rows.filter({hasText: 'fh-product-card'});
      await (
        (await update.count()) > 0 ? update.first() : rows.first()
      ).click();
      await sleep(500);
      return {app, panel};
    },
  },
  {
    name: 'screenshot-4-updates.png',
    async capture({app, openPanel}) {
      const panel = await record(app, await openPanel('timeline'));
      await panel
        .locator('lit-devtools-panel segmented-tabs')
        .first()
        .getByText('Updates', {exact: true})
        .click();
      const rows = panel.locator('updates-view .row');
      await rows.first().waitFor();
      const card = rows.filter({hasText: 'fh-product-card'});
      await ((await card.count()) > 0 ? card.first() : rows.first()).click();
      await sleep(600);
      return {app, panel};
    },
  },
];

const renderScreenshots = async (browser) => {
  const server = await preview({
    root: APP,
    preview: {port: 4181, strictPort: false},
    logLevel: 'warn',
  });
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  const work = await mkdtemp(path.join(tmpdir(), 'lit-extension-assets-'));
  let context;
  try {
    // The build as shipped, plus the grant the user would click through.
    const unpacked = path.join(work, 'unpacked');
    await cp(DIST, unpacked, {recursive: true});
    const manifestPath = path.join(unpacked, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions = [`${origin}/*`];
    await writeFile(manifestPath, JSON.stringify(manifest));

    context = await chromium.launchPersistentContext(
      path.join(work, 'profile'),
      {
        channel: 'chromium',
        headless: process.env['ASSETS_HEADED'] === undefined,
        colorScheme: 'dark',
        viewport: null,
        args: [
          `--disable-extensions-except=${unpacked}`,
          `--load-extension=${unpacked}`,
        ],
      }
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${id}/devtools.html`);
    await extensionPage.evaluate(
      (origin) => chrome.runtime.sendMessage({type: 'lit:enable', origin}),
      origin
    );

    const {height, width, pageWidth} = SCREENSHOT;
    for (const shot of SHOTS) {
      const app = await context.newPage();
      await app.setViewportSize({width: pageWidth, height});
      await app.goto(origin);
      await app.locator('fh-product-card').first().waitFor();
      const tabId = await extensionPage.evaluate(
        async (origin) =>
          (await chrome.tabs.query({url: `${origin}/*`}))[0]?.id,
        origin
      );
      const opened = [];
      const openPanel = async (tab) => {
        const panel = await context.newPage();
        // The shots read the Timeline's list; it opens in Tracks.
        await panel.addInitScript(() =>
          localStorage.setItem('lit-devtools-timeline-mode', 'list')
        );
        opened.push(panel);
        await panel.setViewportSize({width: width - pageWidth - 1, height});
        await panel.goto(
          `chrome-extension://${id}/panel.html?tabId=${tabId}#tab=${tab}`
        );
        await panel
          .locator('#page', {hasText: 'Lit runtime connected'})
          .waitFor({timeout: 15_000});
        return panel;
      };
      const pages = await shot.capture({app, openPanel});
      await composeScreenshot(
        browser,
        {
          page: await pages.app.screenshot(),
          panel: await pages.panel.screenshot(),
        },
        path.join(STORE, shot.name)
      );
      for (const page of [app, ...opened]) await page.close();
    }
  } finally {
    await context?.close();
    await server.close();
    await rm(work, {recursive: true, force: true});
  }
};

/* ------------------------------------------------------------------- main */

const argv = process.argv.slice(2);
const only = argv.find((arg) => !arg.startsWith('--'));

if (argv.includes('--build')) {
  const run = (command, args, cwd = ROOT) =>
    execFileSync(command, args, {cwd, stdio: 'inherit'});
  run('pnpm', ['run', 'build']);
  run('pnpm', ['run', 'build:extension']);
  run('pnpm', ['run', 'build'], APP);
}

const browser = await chromium.launch({channel: 'chromium'});
try {
  if (only === undefined || only === 'icons') {
    console.log('icons');
    await renderIcons(browser);
  }
  if (only === undefined || only === 'store') {
    console.log('store');
    await mkdir(STORE, {recursive: true});
    for (const tile of TILES) await renderTile(browser, tile);
    await renderScreenshots(browser);
  }
} finally {
  await browser.close();
}
