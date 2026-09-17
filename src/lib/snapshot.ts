/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Freezing a live session into a static panel someone else can open.
 *
 * Capture needs no transport: by the time a developer wants to export, the
 * node side is already holding the timeline buffer, the component tree, the
 * details of everything that was inspected, and the HMR incompatibility list.
 * The export reads its own state and hands it to devframe's build adapter as
 * a second, replaying definition.
 *
 * The output is a plain directory: the panel SPA, a `__connection.json` that
 * says `backend: 'static'`, and the baked RPC dump. It is mount-path agnostic,
 * so it works opened from a file server at any base — zip it onto an issue.
 */

import {createLitDevframe} from './devframe/definition.js';
import {createNullSource} from './devframe/source.js';
import type {FeatureSettings} from '../types/timeline.js';
import type {SessionSnapshot} from '../types/snapshot.js';

/** What {@link buildSnapshot} reports back to whoever asked for the export. */
export interface SnapshotBuildResult {
  outDir: string;
  events: number;
  components: number;
  details: number;
}

/** Count the nodes of a tree, so the caller can say what it exported. */
const countNodes = (nodes: SessionSnapshot['roots']): number =>
  nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);

/**
 * Write `snapshot` to `outDir` as a self-contained static panel.
 *
 * The build adapter is imported dynamically: it reaches for `node:fs`, and
 * `definition.ts` is deliberately framework- and environment-neutral, so a
 * static import would drag filesystem code into every context that merely
 * builds the definition.
 */
export const buildSnapshot = async (
  snapshot: SessionSnapshot,
  options: {
    outDir: string;
    features: FeatureSettings | null;
    clientAssets?: string;
  }
): Promise<SnapshotBuildResult> => {
  const {createBuild} = await import('devframe/adapters/build');
  const definition = createLitDevframe({
    // Nothing to attach to: the page this session describes is gone, and
    // every answer the frozen panel needs is already in `replay`.
    source: createNullSource(),
    version: snapshot.version,
    features: () => options.features,
    clientAssets: options.clientAssets,
    replay: snapshot,
  });

  await createBuild(definition, {
    outDir: options.outDir,
    // The Vite plugin declares `capabilities.build: false` because there is
    // nothing to render during `vite build` — a *recorded* session is the one
    // case where a build does make sense.
    force: true,
  });

  return {
    outDir: options.outDir,
    events: snapshot.events.length,
    components: countNodes(snapshot.roots),
    details: snapshot.details.length,
  };
};
