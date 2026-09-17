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
 * 1. `@devframes/service-open`, the host-wide wire service. Present whenever
 *    a devframe host installed it — this plugin declares it (see
 *    `lib/devframe/definition.ts`), so under Vite it is there as soon as the
 *    panel is. Its containment check runs against the host's `workspaceRoot`
 *    plus the roots we declared, and it resolves symlinks.
 * 2. `/__lit-open-in-editor`, the plugin's own endpoint. Still the only path
 *    the in-page source overlay has (it carries no devframe client and must
 *    work with `timeline: false`), so it is not going anywhere; here it is
 *    the fallback for a host that never installed the service.
 *
 * Both end up in `launch-editor`, so the user-visible result is the same.
 */

import {litRpc} from './client.js';
// Type-only: pulls in the package's `declare module 'devframe'` augmentation,
// which types its RPC ids (`devframes:service:open:*`) and its entry in the
// client-side service registry. Nothing is imported at runtime.
import type {} from '@devframes/service-open';

const OPEN_SERVICE = '@devframes/service-open';

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
    // `services` lives on the unscoped client; the `lit:`-scoped context
    // deliberately only carries this plugin's own surface.
    const service = client.base.services.get(OPEN_SERVICE);
    if (service !== undefined) {
      await service.rpc.call('open-in-editor', {path: file, line});
      return;
    }
  } catch (err) {
    console.warn(
      '[lit-devtools] service-open failed, falling back to the endpoint',
      err
    );
  }
  try {
    await openViaEndpoint(file, line);
  } catch (err) {
    console.warn('[lit-devtools] open-in-editor failed', err);
  }
};
