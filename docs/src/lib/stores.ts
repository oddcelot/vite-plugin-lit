/**
 * Where Lit Inspector is published. Every store button on the site reads
 * this, so a listing going live is a one-line change here: set its `url` and
 * the "Coming soon" placeholder turns into a link on every page at once.
 */
export const stores = {
  chrome: {
    name: 'Chrome Web Store',
    url: 'https://chromewebstore.google.com/detail/lit-inspector/faojnglflincboehhgkjgehnapjgiieh' as
      | string
      | undefined,
  },
  firefox: {
    name: 'Firefox Add-ons',
    url: undefined as string | undefined,
  },
};

export type Store = keyof typeof stores;

/**
 * `url` tagged with UTM parameters, so the store's own analytics can tell
 * the docs' clicks apart: the Chrome Web Store dashboard breaks listing page
 * views down by `utm_source`, `utm_medium` and `utm_campaign`. `campaign`
 * names the page the link sits on.
 */
export const trackedUrl = (url: string, campaign: string): string => {
  const tracked = new URL(url);
  tracked.searchParams.set('utm_source', 'docs');
  tracked.searchParams.set('utm_medium', 'store-button');
  tracked.searchParams.set('utm_campaign', campaign);
  return tracked.href;
};
