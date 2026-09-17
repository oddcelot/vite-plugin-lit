/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Opening a source location from the panel.
 *
 * Two paths, in order:
 *
 * 1. `lit:open-source`, which hands the location to `@devframes/service-open`
 *    (the host-wide wire service a Vite hub always installs). The hop through
 *    our own node side is what makes the path right: `file` is relative to
 *    the Vite root, and the service resolves relative paths against the
 *    host's `workspaceRoot`, which is a different directory whenever the
 *    served app isn't the workspace itself.
 * 2. `/__lit-open-in-editor`, the plugin's own endpoint. Still the only path
 *    the in-page source overlay has (it carries no devframe client and must
 *    work with `timeline: false`), so it is not going anywhere; here it is
 *    the fallback for a host with no open service.
 *
 * Both end up in `launch-editor`, so the user-visible result is the same.
 */

import {litRpc} from './client.js';

/** Today's endpoint. The fallback, and what the source overlay always uses. */
const openViaEndpoint = async (file: string, line: number): Promise<void> => {
  const params = new URLSearchParams({file, line: String(line)});
  const res = await fetch(`/__lit-open-in-editor?${params.toString()}`);
  if (!res.ok) {
    throw new Error(
      `open-in-editor failed (${res.status}): ${await res.text()}`
    );
  }
};

/**
 * Open `file` at `line` in the developer's editor. Never throws: a failure is
 * logged, since there is no panel surface for it and the developer can always
 * open the file themselves.
 */
export const openInEditor = async (
  file: string,
  line: number
): Promise<void> => {
  try {
    const client = await litRpc();
    const {opened} = await client.rpc.call('open-source', {file, line});
    if (opened) return;
  } catch (err) {
    console.warn(
      '[lit-devtools] open-source failed, falling back to the endpoint',
      err
    );
  }
  try {
    await openViaEndpoint(file, line);
  } catch (err) {
    console.warn('[lit-devtools] open-in-editor failed', err);
  }
};
