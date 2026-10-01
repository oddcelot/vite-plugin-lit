/**
 * Shared types and channel constant for successful-HMR-patch reporting, the
 * counterpart of `hmr-incompatibility.ts`. The page runtime reports each patch
 * that landed over {@link HMR_PATCH_CHANNEL}; the node side keeps the newest
 * few so the DevTools panel and the `hmr-history` agent tool can answer "did
 * my edit land" without a recording running.
 */

/** What happened to custom elements a patch re-created. */
export type HmrPatchChildState = 'reset' | 'transfer' | 'reuse';

export interface HmrPatchEvent {
  tagName: string;
  /**
   * Source file of the component, relative to the Vite root. Absent on the
   * wire: the page runtime does not know it, so the node side fills it from
   * the component tree's `source` when the tag is in it.
   */
  file?: string;
  /** Live instances the patch updated. */
  instances: number;
  /** The tag's patch count: 1 after the first hot patch, 2 after the second. */
  generation: number;
  /** Wall time the synchronous patch took, in ms (re-renders are async and not included). */
  durationMs: number;
  /** The `hmr.childState` mode in force for this patch. */
  childState: HmrPatchChildState;
  /** `Date.now()` in the browser, the same clock as `HmrIncompatibilityEvent.time`. */
  at: number;
}

/** HMR channel the page runtime uses to report an {@link HmrPatchEvent}. */
export const HMR_PATCH_CHANNEL = 'lit:hmr:patched';

/** How many patches the node-side history keeps and the panel mirrors. */
export const MAX_HMR_PATCHES = 50;
