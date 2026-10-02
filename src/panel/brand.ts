/**
 * The name and mark in the panel's header. The Vite plugin and
 * `lit-devtools dev` show the Lit flame and "Lit DevTools"; a host that ships
 * the panel under its own name (the Chrome extension, Lit Inspector) sets
 * its own with {@link useBrand} before the panel mounts.
 */

export interface PanelBrand {
  /** Shown next to the mark, upper-cased by the header's style. */
  name: string;
  /** The mark, drawn at 20×20. Absent: the Lit flame. */
  iconUrl?: string;
}

const DEFAULT_BRAND: PanelBrand = {name: 'Lit DevTools'};

let current: PanelBrand = DEFAULT_BRAND;

/** Sets the header's brand. Call before `<lit-devtools-panel>` renders. */
export const useBrand = (brand: PanelBrand): void => {
  current = brand;
};

/** The header's brand: the one set by {@link useBrand}, or the default. */
export const panelBrand = (): PanelBrand => current;
