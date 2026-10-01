/**
 * Settles devframe's settings mirror before anything reads or writes it.
 *
 * `client.settings.global` is built on a shared state fetched with
 * `{initialValue: {}}`. For that form devframe's client
 * (`createRpcSharedStateClientHost`, `get`) registers the local copy at once
 * and fires `server-state:get` without waiting for it; when the reply lands it
 * `mutate`s the copy to `{...initial, ...serverState}` and broadcasts that
 * with `server-state:set`. A write issued in between is applied locally and
 * sent, then replaced by that merge and overwritten on the server with the
 * initial value, so a setting changed right after the panel opens is lost.
 *
 * Fetching the same key *without* an `initialValue` takes devframe's other
 * branch, which awaits the server's value before registering the state. Every
 * later `get` for the key (including the settings store's own) then returns
 * that already-synced state, so no late reply is left to clobber a write.
 */

import {LIT_DEVFRAME_ID} from '../lib/devframe/protocol.js';

/** Devframe's shared-state key for the per-user (`global`) settings store. */
export const SETTINGS_STATE_KEY = `devframe:settings:global:${LIT_DEVFRAME_ID}`;

/** The slice of the devframe client this needs. */
export interface SettingsSyncClient {
  base: {
    connectionMeta?: {backend?: string};
    sharedState: {get(key: string): Promise<unknown>};
  };
}

/**
 * Resolves once the settings mirror holds the server's value. Never rejects:
 * a failed sync falls back to devframe's lazy behaviour, which is what the
 * panel did before, and a static snapshot has no server to sync with.
 */
export const settleSettings = async (
  client: SettingsSyncClient
): Promise<void> => {
  if (client.base.connectionMeta?.backend === 'static') return;
  try {
    await client.base.sharedState.get(SETTINGS_STATE_KEY);
  } catch {
    // dev tool — an unreachable store is not an error
  }
};

/**
 * Memoizes {@link settleSettings} per client, so the sync happens once per
 * connection and every durable read and write waits on the same promise.
 */
export const createSettingsGate = <C extends SettingsSyncClient>(
  connect: () => Promise<C>
): (() => Promise<C>) => {
  let ready: Promise<C> | undefined;
  return () =>
    (ready ??= connect().then(async (client) => {
      await settleSettings(client);
      return client;
    }));
};
