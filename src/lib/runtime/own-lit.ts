/**
 * Keeps the runtime's own bundled Lit out of the page's Lit version lists.
 *
 * The classic-script bundles (`lit-devtools.js`, the extension's page script)
 * carry the element picker, a LitElement, and so a private copy of lit-html,
 * lit-element and reactive-element. Each copy pushes its version onto
 * `globalThis.litHtmlVersions` / `litElementVersions` /
 * `reactiveElementVersions` when it evaluates, and the inspector reads those
 * lists to tell the panel whether the page loads Lit more than once. Our copy
 * made every inspected page look like a duplicate.
 *
 * Why this and not a marker the inspector filters on: the lists hold bare
 * version strings that Lit pushes itself (a plain `push`, in both its dev and
 * production builds), so there is nothing to tag. And the page's own Lit may
 * evaluate after us, where it would count our entry as a sibling and, in dev
 * mode, warn about "multiple versions". Removing our entries from the lists
 * fixes both, at the source, for the panel and for the page alike.
 *
 * Import this FIRST in a bundle, so the baseline is taken before any of our
 * Lit evaluates, and call {@link forgetOwnLit} once every import is done.
 * Nothing else may import it: a module that is not a bundle entry shares its
 * Lit with the page and has nothing to forget.
 */

const LISTS = [
  'litHtmlVersions',
  'litElementVersions',
  'reactiveElementVersions',
] as const;

type Lists = Record<string, string[] | undefined>;

const baseline = LISTS.map(
  (name) => (globalThis as unknown as Lists)[name]?.length ?? 0
);

/**
 * Removes the entries our own Lit added since this module evaluated. Static
 * imports evaluate synchronously and in order, so everything past the
 * baseline is ours; the page's Lit cannot have interleaved.
 */
export const forgetOwnLit = (): void => {
  const g = globalThis as unknown as Lists;
  LISTS.forEach((name, i) => g[name]?.splice(baseline[i]!));
};
