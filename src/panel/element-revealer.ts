/**
 * Selecting a page element in the host's own element inspector, where the
 * host has one.
 *
 * The Lit Inspector extension runs inside DevTools, whose Elements panel can
 * select any node; it registers that with {@link useElementRevealer} before
 * the panel mounts. No other host does (the Vite dock, standalone and CLI
 * have no such panel, and the extension's plain-tab test seam has no
 * `chrome.devtools`), and this module knows nothing of `chrome`. It is a seam
 * of the panel rather than a host capability because only the wrapper page
 * that holds `chrome.devtools` can tell, and the panel runs in that page.
 */

/** Selects the element with the runtime's numeric `id` in the host's inspector. */
export type ElementRevealer = (id: number) => void | Promise<void>;

let current: ElementRevealer | undefined;

/** Sets the host's revealer; `undefined` removes it. Call before the panel mounts. */
export const useElementRevealer = (
  revealer: ElementRevealer | undefined
): void => {
  current = revealer;
};

/** The host's revealer, when it gave one. */
export const elementRevealer = (): ElementRevealer | undefined => current;
