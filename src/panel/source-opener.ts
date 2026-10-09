/**
 * Opening a location in the host's own source viewer, where it has one.
 *
 * The Lit Inspector extension resolves components through the page's
 * sourcemaps; their locations carry the original source's `url`, and it
 * opens them in DevTools' own Sources panel. It registers that with
 * {@link useSourceOpener} before the panel mounts. No other host does, and
 * this module knows nothing of `chrome`: a location with no opener goes to
 * the editor (`open-in-editor.ts`) as before.
 *
 * A location with no `url` (one the plugin stamped, a file path) belongs to
 * the editor when the host can open one. Where it cannot, as in the
 * extension, the opener finds what the page loaded for that file itself.
 */

import type {ElementSource} from '../types/inspector.js';

/** Opens `location` somewhere the developer can read it. */
export type SourceOpener = (location: ElementSource) => void | Promise<void>;

let current: SourceOpener | undefined;

/** Sets the host's opener; `undefined` removes it. Call before the panel mounts. */
export const useSourceOpener = (opener: SourceOpener | undefined): void => {
  current = opener;
};

/**
 * The opener for `location`, when the host gave one. A URL always goes to it;
 * a bare file path only when no editor can take it, so the editor stays the
 * default wherever the host has one.
 */
export const sourceOpenerFor = (
  location: ElementSource,
  editorAvailable: boolean
): SourceOpener | undefined =>
  location.url !== undefined || !editorAvailable ? current : undefined;
