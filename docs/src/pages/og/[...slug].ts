/**
 * One Open Graph card per docs page, rendered at build time: satori lays the
 * card out as SVG, sharp rasterises it to PNG. Each card carries the Lit flame
 * and the site name, the page's section, its title and its description, on a
 * deep Lit-blue gradient with a cyan rule along the bottom edge.
 *
 * The text is set in the site's own Manrope, read through Astro's font data
 * (the `--font-manrope-og` entry in astro.config.mjs, which exists because
 * satori reads neither the site's woff2 files nor variable fonts).
 */
import {readFile} from 'node:fs/promises';
import type {APIRoute, GetStaticPaths} from 'astro';
import {experimental_getFontFileURL, fontData} from 'astro:assets';
import {getCollection, type CollectionEntry} from 'astro:content';
import satori from 'satori';
import sharp from 'sharp';
import {OG_HEIGHT, OG_WIDTH, ogImageSlug} from '../../lib/og';

type Entry = CollectionEntry<'docs'>;

export const getStaticPaths = (async () => {
  const entries = await getCollection('docs');
  return entries.map((entry) => ({
    params: {slug: ogImageSlug(entry.id)},
    props: {entry},
  }));
}) satisfies GetStaticPaths;

/** Sidebar group labels, by the top-level directory an entry lives in. */
const SECTIONS: Record<string, string> = {
  start: 'Start here',
  guides: 'Guides',
  concepts: 'Concepts',
  reference: 'Reference',
  contributing: 'Contributing',
};

const flame = `data:image/svg+xml;base64,${(
  await readFile('./src/assets/lit-flame.svg')
).toString('base64')}`;

let fonts: Promise<Parameters<typeof satori>[1]['fonts']> | undefined;

/** The two static Manrope weights, fetched once per build. */
function loadFonts(base: URL) {
  fonts ??= Promise.all(
    ([500, 800] as const).map(async (weight) => {
      const url = fontData['--font-manrope-og']?.find(
        (face) => face.weight === String(weight)
      )?.src[0]?.url;
      if (url === undefined) {
        throw new Error(
          `No Manrope ${weight} in the --font-manrope-og font data.`
        );
      }
      const data = await fetch(experimental_getFontFileURL(url, base)).then(
        (res) => res.arrayBuffer()
      );
      return {name: 'Manrope', data, weight, style: 'normal' as const};
    })
  );
  return fonts;
}

/**
 * A satori element; satori takes React-shaped nodes, no JSX needed. Nulls are
 * dropped and a lone child is passed bare, because satori counts every array
 * slot as a child and demands `display: flex` once there are two.
 */
function h(
  type: string,
  style: Record<string, string | number>,
  ...children: unknown[]
) {
  const kept = children.filter((child) => child != null);
  return {type, props: {style, children: kept.length === 1 ? kept[0] : kept}};
}

/** The home page's title is the site name, so its card leads with the tagline's opening instead. */
function headline(entry: Entry): string {
  const tagline = entry.data.hero?.tagline;
  if (entry.id !== 'index' || typeof tagline !== 'string')
    return entry.data.title;
  return tagline
    .split(/(?<=\.)\s+/)
    .slice(0, 2)
    .join(' ');
}

export const GET: APIRoute<{entry: Entry}> = async ({props: {entry}, url}) => {
  const section = SECTIONS[entry.id.split('/')[0]];
  const card = h(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 72px 72px',
      backgroundImage: 'linear-gradient(135deg, #161c5c 0%, #080a22 100%)',
      borderBottom: '10px solid #00e8ff',
      fontFamily: 'Manrope',
      color: '#ffffff',
    },
    h(
      'div',
      {display: 'flex', alignItems: 'center', gap: 20},
      {type: 'img', props: {src: flame, width: 52, height: 64}},
      h('div', {fontSize: 34, fontWeight: 800}, 'vite-plugin-lit')
    ),
    h(
      'div',
      {display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1020},
      section
        ? h(
            'div',
            {
              fontSize: 24,
              fontWeight: 800,
              color: '#00e8ff',
              textTransform: 'uppercase',
              letterSpacing: 2,
            },
            section
          )
        : null,
      h(
        'div',
        {fontSize: 68, fontWeight: 800, lineHeight: 1.12},
        headline(entry)
      ),
      entry.data.description
        ? h(
            'div',
            {
              fontSize: 32,
              fontWeight: 500,
              lineHeight: 1.4,
              color: '#c4ccff',
              lineClamp: 3,
            },
            entry.data.description
          )
        : null
    )
  );

  const svg = await satori(card as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: await loadFonts(url),
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), {
    headers: {'Content-Type': 'image/png'},
  });
};
