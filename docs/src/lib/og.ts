/**
 * Where a docs page's Open Graph image lives. The image endpoint
 * (`src/pages/og/[...slug].ts`) generates one PNG per entry of the `docs`
 * collection under this path, and the route middleware (`src/routeData.ts`)
 * points each page's `og:image` at it — both go through here so the two can
 * never disagree about the URL.
 */

/** Rendered size of every card; the middleware publishes it as og:image:width/height. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Image path for a `docs` collection entry id, relative to `og/`. The
 * collection calls the home page `index`, but Starlight's route data hands the
 * middleware `''` for it, so both spellings land on the same file.
 */
export function ogImageSlug(entryId: string): string {
  return `${entryId || 'index'}.png`;
}
