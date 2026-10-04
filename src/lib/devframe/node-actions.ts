/**
 * The devframe actions that need a Node host: opening a source file in the
 * developer's editor, and writing a snapshot of the session to disk. Only
 * Node hosts (the Vite plugin, `lit-devtools dev`) create these and hand
 * them to the definition, which stays loadable in a browser; a host without
 * them reports neither capability.
 *
 * Imports nothing from `node:` at module scope, so a bundler that follows it
 * from a Node host's graph pulls in nothing until an action runs.
 */

import type {OpenServiceApi} from '@devframes/service-open';
import type {FeatureSettings, SettingsOverride} from '../../types/timeline.js';
import type {SessionSnapshot} from '../../types/snapshot.js';
import type {SourceLocator} from '../source-locator.js';
import {resolveLaunchEditor} from './launch-editor.js';
import type {
  ExportSnapshotArgs,
  ExportSnapshotResult,
  OpenSourceArgs,
  OpenSourceResult,
} from './protocol.js';

export interface NodeActionsOptions {
  /**
   * Resolves the injected `ElementSource.file` paths for `open-source` and
   * confines opens to its roots (the Vite host's root and
   * `server.fs.allow`). Read per call, since a host only knows its roots once
   * its dev server is up. Without one, or before it has roots, the process's
   * working directory is the only root.
   */
  sourceLocator?: () => SourceLocator | undefined;
  /**
   * The editor key the developer named in config or env
   * (`sourceOverlay.editor`), or `undefined` when they never did. Read per
   * call. `open-source` maps it, or the panel's override of it, to a
   * `launch-editor` command; without either the editor is auto-detected.
   */
  configuredEditor?: () => string | undefined;
}

export interface NodeActions {
  openSource(
    args: OpenSourceArgs,
    host: {
      /** The hub's open service; nothing opens without one. */
      service: OpenServiceApi | undefined;
      /** The panel's settings override, for its editor choice. */
      override: SettingsOverride | undefined;
    }
  ): Promise<OpenSourceResult>;
  exportSnapshot(
    args: ExportSnapshotArgs,
    snapshot: SessionSnapshot,
    build: {features: FeatureSettings | null; clientAssets?: string}
  ): Promise<ExportSnapshotResult>;
}

export const createNodeActions = (
  options: NodeActionsOptions = {}
): NodeActions => ({
  // Resolving here rather than in the panel is the whole point of the hop:
  // `file` is relative to the Vite root, while the open service resolves
  // relative paths against the host's `workspaceRoot` -- in a monorepo (or
  // any setup where the served app isn't the workspace) those are different
  // directories, and `launchEditor` silently does nothing for a path that
  // doesn't exist.
  async openSource(args, {service, override}) {
    if (service === undefined) return {opened: false};
    // Confined like `/__lit-open-in-editor`: whatever can reach this RPC
    // could otherwise have the editor open any file on disk.
    const {createSourceLocator} = await import('../source-locator.js');
    let locator = options.sourceLocator?.();
    if (locator === undefined || locator.roots.length === 0) {
      locator = createSourceLocator([process.cwd()]);
    }
    const confined = locator.resolve(args.file);
    if ('failure' in confined) return {opened: false};
    await service.openInEditor({
      path: confined.path,
      line: args.line,
      column: args.column,
      editor: resolveLaunchEditor(options.configuredEditor?.(), override),
    });
    return {opened: true};
  },

  async exportSnapshot(args, snapshot, build) {
    // The build adapter reaches straight for `node:fs`; load it only when a
    // snapshot is actually written.
    const {buildSnapshot} = await import('../snapshot.js');
    // `outDir` comes from the client and the build deletes it before
    // writing, so it has to land strictly beneath the working directory --
    // never the directory itself, and never elsewhere on disk (symlinks
    // included). It usually does not exist yet.
    const {confineToRoots} = await import('../confine.js');
    const cwd = process.cwd();
    const confined = confineToRoots(
      [cwd],
      args.outDir ?? 'lit-devtools-snapshot',
      {mustExist: false, allowRoot: false}
    );
    if ('failure' in confined) {
      throw new Error(
        `[lit-devtools] export-snapshot: outDir must be inside ${cwd}`
      );
    }
    return buildSnapshot(snapshot, {outDir: confined.path, ...build});
  },
});
