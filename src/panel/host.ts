/**
 * What the host behind this panel can do, and how to reach its page. Views
 * ask here instead of combining `get-meta`, snapshot mode and the in-page
 * channel themselves.
 *
 * - {@link hostInfo}: the host's capabilities, read once per panel, with
 *   snapshot mode folded in, so `picker` already means "Pick can work".
 * - {@link sendToPage}: an inspector command to the page, by the fastest
 *   route there is, or nowhere in a frozen snapshot.
 * - {@link touchPageChannel}: connect the lazy in-page channel, so the page
 *   sees the panel leave.
 */

import type {InspectorCommand} from '../types/inspector.js';
import type {LitCapabilities} from '../lib/devframe/protocol.js';
import {getMeta, isSnapshot, litRpc, type LitClient} from './client.js';
import {inPageChannel, inPageConnected} from './in-page.js';

export interface HostInfo extends LitCapabilities {
  /** A frozen snapshot: no page behind it, so nothing to command. */
  snapshot: boolean;
  /** The page has an element picker and is live, so Pick can work. */
  picker: boolean;
}

/**
 * What to assume when `get-meta` can't be read: nothing that would offer a
 * control that only fails. `hmr` stays on so the timeline doesn't explain an
 * empty render layer by blaming a production build it can't see.
 */
const UNKNOWN: Omit<HostInfo, 'snapshot'> = {
  picker: false,
  openInEditor: false,
  exportSnapshot: false,
  pluginSettings: false,
  hmr: true,
  sourceLocations: false,
  componentDocs: false,
};

let info: Promise<HostInfo> | undefined;
/** The connection once it is up, so commands go out without a wait. */
let connected: LitClient | undefined;

/**
 * The host's capabilities. Read once: they describe the host, which does
 * not change while this panel is connected to it.
 */
export const hostInfo = (): Promise<HostInfo> =>
  (info ??= getMeta().then(
    (meta): HostInfo => {
      // `get-meta` has resolved, so the connection has too.
      const snapshot = isSnapshot();
      return {
        ...meta.capabilities,
        snapshot,
        picker: meta.picker && !snapshot,
      };
    },
    (): HostInfo => ({...UNKNOWN, snapshot: isSnapshot()})
  ));

/**
 * Forget the read, so the next {@link hostInfo} asks again. The panel never
 * switches hosts while it runs; tests do, between cases.
 */
export const resetHostInfo = (): void => {
  info = undefined;
  connected = undefined;
};

/**
 * Send an inspector command to the page. Best-effort: a failure is logged.
 *
 * Highlight, reveal and anatomy prefer the direct page channel: highlight fires on
 * every pointer move over the tree, and the RPC route is panel -> node ->
 * page, a full round trip through the dev server for something the page
 * could have drawn itself. The channel is not always there (a panel opened
 * as its own tab has no page script in its ancestry), so RPC stays the
 * fallback.
 */
export const sendToPage = (command: InspectorCommand): void => {
  // Nothing to command in a frozen session: there is no page, and the
  // action is not in the dump.
  if (isSnapshot()) return;
  if (command.type === 'highlight' && inPageConnected()) {
    inPageChannel().emit('highlight', command.id);
    return;
  }
  if (command.type === 'highlight-all' && inPageConnected()) {
    inPageChannel().emit('highlightAll', command.ids);
    return;
  }
  if (command.type === 'reveal' && inPageConnected()) {
    inPageChannel().emit('reveal', command.id);
    return;
  }
  if (command.type === 'anatomy' && inPageConnected()) {
    inPageChannel().emit('anatomy', command.id);
    return;
  }
  if (command.type === 'anatomy-focus' && inPageConnected()) {
    inPageChannel().emit('anatomyFocus', command.focus);
    return;
  }
  const send = (client: LitClient) =>
    client.rpc.call('inspect', command).catch((err: unknown) => {
      console.warn('[lit-devtools] inspector call failed', err);
    });
  if (connected !== undefined) {
    void send(connected);
    return;
  }
  // Not connected yet (a deep-linked selection): wait, then check snapshot
  // mode again, which is only known once connected.
  litRpc().then(
    (client) => {
      connected = client;
      if (!isSnapshot()) void send(client);
    },
    () => {
      // No connection, no page to reach; the view shows the error.
    }
  );
};

/**
 * Connect the lazy in-page channel. The page only learns the panel is gone
 * over it, so Live mode, which the page must stop when the panel leaves,
 * touches it even if the user never hovers the tree.
 */
export const touchPageChannel = (): void => {
  if (!isSnapshot()) inPageConnected();
};
