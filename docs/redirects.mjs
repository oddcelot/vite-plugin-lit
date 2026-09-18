// Pages that moved when the site was reorganised along Diátaxis lines
// (Start here / Guides / Concepts / Reference). Keys are written without the
// base (Astro prefixes them); values get the base prepended in
// astro.config.mjs because Astro emits them verbatim into the meta-refresh
// page. starlight-links-validator resolves links to the old URLs through
// these, and scripts/check-redirects.mjs asserts every target exists after a
// build. Kept in its own module so the check script can import it without
// loading the Starlight integration.
export const base = '/vite-plugin-lit';

export const moved = {
  '/getting-started/installation': '/start/installation/',
  '/getting-started/quick-start': '/start/first-component/',
  '/getting-started/how-it-works': '/concepts/how-hmr-works/',
  '/guides/devtools-timeline': '/guides/devtools/',
  '/guides/devtools-timeline/updates': '/guides/devtools/updates/',
  '/guides/devtools-timeline/custom-layers': '/guides/devtools/custom-layers/',
  '/guides/stylesheets/link-and-inline':
    '/guides/stylesheets/component-styles/',
};

export const redirects = Object.fromEntries(
  Object.entries(moved).map(([from, to]) => [from, base + to])
);
