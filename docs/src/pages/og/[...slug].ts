/**
 * One Open Graph card per docs page, rendered at build time by
 * astro-og-canvas: the Lit flame, the page title and its description on a
 * deep Lit-blue gradient, with a cyan rule along the bottom edge.
 *
 * The fonts are the site's own Manrope, fetched as TTF from the same
 * Fontsource the site's font pipeline uses (CanvasKit can't read the woff2
 * files that pipeline emits). The flame is rasterised from the SVG the site
 * header uses, because CanvasKit only decodes bitmap logos.
 */
import {mkdir} from 'node:fs/promises';
import {getCollection} from 'astro:content';
import {OGImageRoute} from 'astro-og-canvas';
import sharp from 'sharp';
import {ogImageSlug} from '../../lib/og';

const CACHE_DIR = './node_modules/.astro-og-canvas';
const LOGO = `${CACHE_DIR}/lit-flame.png`;

await mkdir(CACHE_DIR, {recursive: true});
await sharp('./src/assets/lit-flame.svg', {density: 600})
  .resize({height: 150})
  .png()
  .toFile(LOGO);

const entries = await getCollection('docs');
const pages = Object.fromEntries(
  entries.map((entry) => [entry.id, entry.data])
);

export const {getStaticPaths, GET} = await OGImageRoute({
  pages,
  getSlug: (id) => ogImageSlug(id),
  getImageOptions: (_id, page) => ({
    title: page.title,
    description: page.description,
    logo: {path: LOGO, size: [96]},
    // --lit-dark-blue deepened, so the flame's own dark-blue facets still read.
    bgGradient: [
      [22, 28, 92],
      [8, 10, 34],
    ],
    border: {color: [0, 232, 255], width: 10, side: 'block-end'},
    padding: 72,
    fonts: [
      'https://api.fontsource.org/v1/fonts/manrope/latin-800-normal.ttf',
      'https://api.fontsource.org/v1/fonts/manrope/latin-500-normal.ttf',
    ],
    font: {
      title: {
        families: ['Manrope'],
        weight: 'ExtraBold',
        size: 68,
        lineHeight: 1.15,
        color: [255, 255, 255],
      },
      description: {
        families: ['Manrope'],
        weight: 'Medium',
        size: 34,
        lineHeight: 1.4,
        color: [196, 204, 255],
      },
    },
    cacheDir: CACHE_DIR,
  }),
});
