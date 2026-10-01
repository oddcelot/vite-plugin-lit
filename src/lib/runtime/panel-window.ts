/**
 * Raising the standalone panel from the page, as far as a page can.
 *
 * Under `lit-devtools dev` the panel is its own browser tab, and no page can
 * bring another tab to the front. The one thing it can do, inside a user
 * gesture, is `window.open` a named window: a window of that name this page
 * opened before is navigated and focused instead of a new one appearing.
 */

/** The window name every pick targets; see {@link pickInto}. */
export const PANEL_WINDOW_NAME = 'lit-devtools-panel';

/**
 * Bring the panel to the front on the element just picked. The pick is a
 * click, so the page may open a window; naming it means later picks focus the
 * same tab, and only the hash changes, so the panel follows the link without
 * reloading. A panel tab the developer opened by hand is not one this page
 * can find by name: the first pick then opens a second panel, and later picks
 * reuse that one.
 */
export const pickInto =
  (
    panelUrl: string,
    open: (url: string, name: string) => unknown = (url, name) =>
      window.open(url, name)
  ) =>
  (id: number): void => {
    const url = new URL(panelUrl);
    url.hash = `tab=components&component=${id}`;
    open(url.href, PANEL_WINDOW_NAME);
  };
