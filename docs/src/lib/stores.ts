/**
 * Where Lit Inspector is published. Every store button on the site reads
 * this, so a listing going live is a one-line change here: set its `url` and
 * the "Coming soon" placeholder turns into a link on every page at once.
 */
export const stores = {
  chrome: {
    name: 'Chrome Web Store',
    url: undefined as string | undefined,
  },
  firefox: {
    name: 'Firefox Add-ons',
    url: undefined as string | undefined,
  },
};

export type Store = keyof typeof stores;
