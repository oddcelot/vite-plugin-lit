/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * The panel end of the direct page channel (see `types/in-page.ts`).
 *
 * Connected lazily, on first use, rather than at panel boot: connecting posts
 * handshake hellos at every window a page script could live in, and a panel
 * whose user never opens the Components tab has no reason to do that.
 *
 * There is deliberately no error path. The channel is an optimisation over a
 * working RPC route, and it legitimately never connects when the panel is
 * opened as its own tab (no ancestor page to handshake with). Callers check
 * {@link inPageConnected} and fall back.
 */

import {connectPanelChannel} from 'devframe/in-page-channel';
import type {PanelChannel} from 'devframe/in-page-channel';
import {LIT_IN_PAGE_CHANNEL, type LitInPageProtocol} from '../types/in-page.js';

let channel: PanelChannel<LitInPageProtocol> | undefined;

/** The shared channel endpoint, created on first call. */
export const inPageChannel = (): PanelChannel<LitInPageProtocol> =>
  (channel ??= connectPanelChannel<LitInPageProtocol>({
    name: LIT_IN_PAGE_CHANNEL,
    functions: {},
  }));

/**
 * Whether the fast path is usable right now. A plain status check, not a
 * promise: callers are on an interaction path (a pointer move over the tree)
 * and must decide synchronously which transport to use.
 */
export const inPageConnected = (): boolean =>
  inPageChannel().status === 'connected';
