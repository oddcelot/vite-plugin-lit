/**
 * Starlight route middleware: points every page's `og:image` at the card
 * `src/pages/og/[...slug].ts` generated for it. Starlight already emits
 * `twitter:card: summary_large_image` and the other OG tags; the image is the
 * only one it has no way to know about.
 */
import {defineRouteMiddleware} from '@astrojs/starlight/route-data';
import {OG_HEIGHT, OG_WIDTH, ogImageSlug} from './lib/og';

export const onRequest = defineRouteMiddleware((context) => {
  const {entry, head} = context.locals.starlightRoute;
  // The 404 page is Starlight's own, not a collection entry, so it has no card.
  if (entry.id === '404') return;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const image = new URL(`${base}/og/${ogImageSlug(entry.id)}`, context.site);
  const meta = (property: string, content: string) =>
    head.push({tag: 'meta', attrs: {property, content}});
  meta('og:image', image.href);
  meta('og:image:width', String(OG_WIDTH));
  meta('og:image:height', String(OG_HEIGHT));
  meta('og:image:alt', entry.data.title);
});
