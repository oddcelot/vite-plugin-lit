/**
 * Stands in for `src/lib/snapshot.ts` in the extension build (see
 * `extension/vite.config.ts`). Exporting a snapshot writes a directory to
 * disk, which the extension has no way to do, and the panel hides the button
 * there. The real module pulls in devframe's build adapter, whose remote-asset
 * code carries CDN URLs that have no business in the extension package.
 */

import type {buildSnapshot as BuildSnapshot} from '../../src/lib/snapshot.js';

export const buildSnapshot: typeof BuildSnapshot = () =>
  Promise.reject(
    new Error(
      '[lit-devtools] Export snapshot is not available in the extension'
    )
  );
