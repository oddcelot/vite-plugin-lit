/**
 * What each host the Lit devframe runs on can do, in one table. The
 * definition is told which host it is on and works out the rest here, rather
 * than assuming Vite and having every other host patch the difference.
 *
 * - `vite`: the Vite plugin. Transforms stamp source locations, components
 *   hot-patch, the source overlay is the picker, and the plugin serves its
 *   own open-in-editor endpoint.
 * - `standalone`: `lit-devtools dev`, for pages outside Vite. The page script
 *   brings its own picker; there are no transforms and no HMR.
 * - `extension`: the browser extension's in-panel host. As `standalone`, with
 *   no server behind it.
 * - `snapshot`: a frozen session. No page; what the recording host could do
 *   is replayed from the snapshot.
 * - `none`: the bare definition (the package's default export, an MCP run)
 *   with no page attached.
 *
 * Pure: the definition passes in the facts it can see.
 */

import type {FeatureSettings} from '../../types/timeline.js';
import type {LitCapabilities} from './protocol.js';

export type HostKind =
  | 'vite'
  | 'standalone'
  | 'extension'
  | 'snapshot'
  | 'none';

/** What the definition knows when it asks. */
export interface HostFacts {
  /** A dev session with a page to follow, not a build or a replay. */
  live: boolean;
  /** The resolved plugin settings, when the host has any. */
  features?: FeatureSettings | null;
  /** The host passed Node-only actions (open in editor, export a snapshot). */
  nodeActions: boolean;
  /** What the recording host could do, for a replayed session. */
  recorded?: Partial<LitCapabilities>;
}

export interface HostProfile {
  /** Whether the page has an element picker for the Components tab. */
  picker: boolean;
  capabilities: LitCapabilities;
}

export const hostProfile = (host: HostKind, facts: HostFacts): HostProfile => {
  const {live, features, nodeActions} = facts;
  const pluginSettings = features !== undefined;
  // Writing a directory takes a Node host, and only a live session has
  // anything new to write.
  const exportSnapshot = live && nodeActions;
  switch (host) {
    case 'vite':
      return {
        picker: features?.sourceOverlay.enabled === true,
        capabilities: {
          // The plugin serves `/__lit-open-in-editor` itself, which the panel
          // falls back to when the hub has no open service.
          openInEditor: live,
          exportSnapshot,
          pluginSettings,
          hmr: true,
          sourceLocations: true,
          componentDocs: nodeActions,
        },
      };
    case 'standalone':
    case 'extension':
      return {
        // `lit-devtools.js` starts a picker of its own in the page, and so
        // does the extension's page script.
        picker: true,
        capabilities: {
          // No transform stamped a location to open.
          openInEditor: false,
          exportSnapshot,
          pluginSettings,
          hmr: false,
          sourceLocations: false,
          // `lit-devtools dev` reads manifests under its working directory;
          // the extension has no disk to read.
          componentDocs: nodeActions,
        },
      };
    case 'snapshot':
      return {
        picker: false,
        capabilities: {
          openInEditor: false,
          exportSnapshot: false,
          pluginSettings,
          // A snapshot from before this was recorded came from the Vite
          // plugin, the only host that could export one then.
          hmr: facts.recorded?.hmr ?? true,
          sourceLocations: facts.recorded?.sourceLocations ?? true,
          // A snapshot doesn't carry manifests.
          componentDocs: false,
        },
      };
    case 'none':
      return {
        picker: false,
        capabilities: {
          openInEditor: false,
          exportSnapshot,
          pluginSettings,
          hmr: false,
          sourceLocations: false,
          componentDocs: false,
        },
      };
  }
};
