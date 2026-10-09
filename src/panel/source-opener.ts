/**
 * Opening a location the panel has a URL for, where the host knows how.
 *
 * The Lit Inspector extension resolves components through the page's
 * sourcemaps; their locations carry the original source's `url`, and it
 * opens them in DevTools' own Sources panel. It registers that with
 * {@link useSourceOpener} before the panel mounts. No other host does, and
 * this module knows nothing of `chrome`: a location with no opener goes to
 * the editor (`open-in-editor.ts`) as before.
 */

import type {ElementSource} from '../types/inspector.js';

/** Opens `location` (which has a `url`) somewhere the developer can read it. */
export type SourceOpener = (location: ElementSource) => void | Promise<void>;

let current: SourceOpener | undefined;

/** Sets the host's opener; `undefined` removes it. Call before the panel mounts. */
export const useSourceOpener = (opener: SourceOpener | undefined): void => {
  current = opener;
};

/** The opener for `location`, when it has a URL and the host gave one. */
export const sourceOpenerFor = (
  location: ElementSource
): SourceOpener | undefined =>
  location.url === undefined ? undefined : current;
